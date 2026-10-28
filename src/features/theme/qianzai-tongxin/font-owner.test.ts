import { afterEach, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { loadQianzaiFont } from "./font-owner";
import { QIANZAI_RUNTIME_INPUTS } from "./runtime-inputs";
import { structuredReaderFixtureV2 } from "../consumer-v2/fixtures.test-support";
import type { ConsumerResourceLeaseV2 } from "../consumer-v2/resource-port";
afterEach(() => vi.unstubAllGlobals());
it("verifies font bytes before installation and releases its font face on authority loss", async () => {
  const abort = new AbortController(),
    { model } = structuredReaderFixtureV2();
  const lease: ConsumerResourceLeaseV2 = {
    generation: 1,
    model,
    view: model.entry!,
    signal: abort.signal,
    current: () => !abort.signal.aborted,
    transport: vi.fn(),
  };
  const bytes = new Uint8Array([1, 2, 3]);
  const font = {
    ...QIANZAI_RUNTIME_INPUTS.font!,
    bytes: 3,
    fileSha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const add = vi.fn(),
    remove = vi.fn(),
    created = vi.fn();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("document", { fonts: { add, delete: remove } });
  vi.stubGlobal(
    "FontFace",
    class {
      constructor() {
        created();
      }
      load() {
        return Promise.resolve(this);
      }
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array([9, 9, 9]))),
  );
  await expect(loadQianzaiFont(font, lease)).rejects.toBeDefined();
  expect(created).not.toHaveBeenCalled();
  expect(add).not.toHaveBeenCalled();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(bytes)),
  );
  const owned = await loadQianzaiFont(font, lease);
  expect(add).toHaveBeenCalledOnce();
  abort.abort();
  expect(remove).toHaveBeenCalledOnce();
  owned.release();
  expect(remove).toHaveBeenCalledOnce();
});
it("does not install a font whose load settles after authority cancellation", async () => {
  const abort = new AbortController(),
    { model } = structuredReaderFixtureV2();
  const lease: ConsumerResourceLeaseV2 = {
    generation: 1,
    model,
    view: model.entry!,
    signal: abort.signal,
    current: () => !abort.signal.aborted,
    transport: vi.fn(),
  };
  const bytes = new Uint8Array([1]);
  const add = vi.fn();
  let begin!: () => void, finish!: (v: unknown) => void;
  const started = new Promise<void>((r) => {
    begin = r;
  });
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("document", { fonts: { add, delete: vi.fn() } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(bytes)),
  );
  vi.stubGlobal(
    "FontFace",
    class {
      load() {
        begin();
        return new Promise((r) => {
          finish = r;
        });
      }
    },
  );
  const pending = loadQianzaiFont(
    {
      ...QIANZAI_RUNTIME_INPUTS.font!,
      bytes: 1,
      fileSha256: createHash("sha256").update(bytes).digest("hex"),
    },
    lease,
  );
  await started;
  abort.abort();
  await expect(pending).rejects.toBeDefined();
  finish({});
  expect(add).not.toHaveBeenCalled();
});
it("releases a font if the final bounded completion expires after installation", async () => {
  const abort = new AbortController(),
    { model } = structuredReaderFixtureV2();
  const lease: ConsumerResourceLeaseV2 = {
    generation: 1,
    model,
    view: model.entry!,
    signal: abort.signal,
    current: () => true,
    transport: vi.fn(),
  };
  const bytes = new Uint8Array([1]);
  let now = 0;
  const remove = vi.fn();
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(bytes)),
  );
  vi.stubGlobal(
    "FontFace",
    class {
      load() {
        return Promise.resolve(this);
      }
    },
  );
  vi.stubGlobal("document", {
    fonts: {
      add() {
        now = 1e9;
      },
      delete: remove,
    },
  });
  await expect(
    loadQianzaiFont(
      {
        ...QIANZAI_RUNTIME_INPUTS.font!,
        bytes: 1,
        fileSha256: createHash("sha256").update(bytes).digest("hex"),
      },
      lease,
    ),
  ).rejects.toBeDefined();
  expect(remove).toHaveBeenCalledOnce();
});
