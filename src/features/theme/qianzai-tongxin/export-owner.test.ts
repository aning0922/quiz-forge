import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { qianzaiExportFixture } from "@/features/report/qianzai-tongxin/export.test-support";
import { QianzaiExportOwner, type QianzaiExportLease } from "./export-owner";
import type { renderQianzaiExport } from "@/features/report/qianzai-tongxin/export";
let fixture: Awaited<ReturnType<typeof qianzaiExportFixture>>;
beforeAll(async () => {
  fixture = await qianzaiExportFixture();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function setup(
  render: typeof renderQianzaiExport = async (kind) => ({
    blob: new Blob([kind], { type: "image/png" }),
    width: kind === "poster" ? 941 : 724,
    height: kind === "poster" ? 1672 : 4200,
  }),
) {
  const f = structuredClone(fixture),
    source = new AbortController();
  let model = f.model,
    live = true;
  const lease: QianzaiExportLease = {
    model,
    view: model.report!.view,
    generation: 42,
    signal: source.signal,
    current: () => live,
    getSnapshot: () => model,
    transport: async () => {
      throw Error("NO_NETWORK");
    },
  };
  const create = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => `blob:synthetic-${Math.random()}`),
    revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const owner = new QianzaiExportOwner(lease, f.bindings, f.font, render);
  owner.activate();
  return {
    ...f,
    owner,
    source,
    create,
    revoke,
    lease,
    setModel: (next: typeof model) => {
      model = next;
    },
    revokeLease: () => {
      live = false;
      source.abort();
    },
  };
}
describe("Qianzai export task ownership", () => {
  it("does not promote old false-capability snapshots or old renderer versions", () => {
    const f = setup();
    f.model.report!.view.display.exports.posterPng = false;
    expect(f.owner.availability("poster")).toEqual({
      allowed: false,
      reason: "CAPABILITY_UNAVAILABLE",
    });
    f.model.report!.view.display.exports.posterPng = true;
    f.model.report!.view.renderer.version = "1.0.0";
    expect(f.owner.availability("poster").allowed).toBe(false);
    f.owner.dispose();
  });
  it("requires matching clean selected-character bindings, never scene screenshots", () => {
    const f = setup();
    f.bindings[0] = { ...f.bindings[0]!, layer: "prototype-scene-base" };
    expect(f.owner.availability("poster")).toEqual({
      allowed: false,
      reason: "ARTWORK_UNAVAILABLE",
    });
    expect(f.owner.availability("full-report").allowed).toBe(true);
    f.owner.dispose();
  });
  it("reads latest completed/pending and receipt before late PNG publication without a React update", async () => {
    let finish!: (v: Awaited<ReturnType<typeof renderQianzaiExport>>) => void;
    const f = setup(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    f.owner.open();
    const task = f.owner.generate("poster");
    f.setModel({ ...f.model, pendingOperation: "complete" });
    finish({
      blob: new Blob(["late"], { type: "image/png" }),
      width: 941,
      height: 1672,
    });
    await task;
    expect(f.create).not.toHaveBeenCalled();
    expect(f.owner.getSnapshot().phase).toBe("closed");
    f.setModel(f.model);
    f.model.report!.receipt.reportSnapshotSha256 = "0".repeat(64);
    expect(f.owner.availability("poster").allowed).toBe(false);
    f.owner.dispose();
  });
  it("close cancels only the child task and rejects its late result", async () => {
    let finish!: (v: Awaited<ReturnType<typeof renderQianzaiExport>>) => void;
    let child!: AbortSignal;
    const f = setup((_kind, _scope, signal) => {
      child = signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    f.owner.open();
    const task = f.owner.generate("poster");
    f.owner.close();
    expect(child.aborted).toBe(true);
    expect(f.source.signal.aborted).toBe(false);
    expect(f.lease.current()).toBe(true);
    finish({
      blob: new Blob(["late"], { type: "image/png" }),
      width: 941,
      height: 1672,
    });
    await task;
    expect(f.create).not.toHaveBeenCalled();
    f.owner.dispose();
  });
  it("serializes generation and caches one same Blob per kind until close", async () => {
    const render = vi.fn<typeof renderQianzaiExport>(async (kind) => ({
      blob: new Blob([kind], { type: "image/png" }),
      width: kind === "poster" ? 941 : 724,
      height: kind === "poster" ? 1672 : 4200,
    }));
    const f = setup(render);
    f.owner.open();
    const task = f.owner.generate("poster");
    await f.owner.generate("full-report");
    await task;
    expect(render).toHaveBeenCalledTimes(1);
    await f.owner.generate("full-report");
    await f.owner.generate("poster");
    expect(render).toHaveBeenCalledTimes(2);
    expect(f.create).toHaveBeenCalledTimes(2);
    f.owner.close();
    expect(f.revoke).toHaveBeenCalledTimes(2);
    f.owner.dispose();
  });
  it("downloads and shares the cached PNG, and fails closed on revoke", async () => {
    const f = setup();
    f.owner.open();
    await f.owner.generate("poster");
    const a = {
      href: "",
      download: "",
      style: { display: "" },
      click: vi.fn(),
      remove: vi.fn(),
    };
    vi.stubGlobal("document", {
      createElement: () => a,
      body: { append: vi.fn() },
    });
    let shared: File | undefined;
    vi.stubGlobal("navigator", {
      canShare: () => true,
      share: async (data: { files: File[] }) => {
        shared = data.files[0];
      },
    });
    expect(f.owner.download()).toBe(true);
    const ready = f.owner.getSnapshot();
    expect(a.href).toBe(
      ready.phase === "ready" ? ready.artifact.previewUrl : "",
    );
    expect(await f.owner.share()).toBe("shared");
    expect(await shared!.text()).toBe("poster");
    expect(f.create).toHaveBeenCalledTimes(1);
    f.revokeLease();
    expect(f.revoke).toHaveBeenCalledTimes(1);
    expect(f.owner.download()).toBe(false);
    expect(await f.owner.share()).toBe("unavailable");
    f.owner.dispose();
  });
  it("reports unsupported sharing, cancellation and failure without generating another PNG", async () => {
    const f = setup();
    f.owner.open();
    await f.owner.generate("poster");
    vi.stubGlobal("navigator", {});
    expect(await f.owner.share()).toBe("download-required");
    vi.stubGlobal("navigator", {
      share: async () => {
        throw new DOMException("cancel", "AbortError");
      },
    });
    expect(await f.owner.share()).toBe("cancelled");
    vi.stubGlobal("navigator", {
      share: async () => {
        throw Error("platform");
      },
    });
    expect(await f.owner.share()).toBe("failed");
    expect(f.create).toHaveBeenCalledTimes(1);
    f.owner.dispose();
  });
});
