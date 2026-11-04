import { describe, expect, it, vi } from "vitest";
import { structuredReaderFixtureV2 } from "../consumer-v2/fixtures.test-support";
import {
  admittedQianzaiBindings,
  QianzaiResourceOwner,
  type QianzaiAssetBinding,
} from "./resource-owner";
import {
  createConsumerResourcePortV2,
  type ConsumerResourceLeaseV2,
} from "../consumer-v2/resource-port";
import type { VerifiedImage } from "@/lib/browser/display-assets";
const fixture = () => {
  const { model } = structuredReaderFixtureV2(),
    asset = model.entry!.assets.find(
      (a) => a.resourceRef.id === model.entry!.slots.cover.id,
    )!;
  const { alt, ...facts } = asset;
  void alt;
  const binding: QianzaiAssetBinding = {
    asset: facts,
    slot: "cover",
    layer: "prototype-scene-base",
  };
  return { model, asset, binding };
};
describe("exact neutral resource roles and ownership", () => {
  it("binds expected complete byte facts to their specific slot without granting approval", () => {
    const { model, binding } = fixture();
    expect(admittedQianzaiBindings(model, [binding])).toHaveLength(1);
    for (const changed of [
      { ...binding, asset: { ...binding.asset, sha256: "0".repeat(64) } },
      {
        ...binding,
        asset: { ...binding.asset, width: binding.asset.width + 1 },
      },
      {
        ...binding,
        asset: {
          ...binding.asset,
          resourceRef: {
            ...binding.asset.resourceRef,
            productId: "other-product",
          },
        },
      },
      { ...binding, slot: "acts.0.optionIdle" as const },
      { ...binding, layer: "prototype-option-skin" as const },
      { ...binding, asset: { ...binding.asset, approval: "pending" as const } },
    ])
      expect(admittedQianzaiBindings(model, [changed])).toEqual([]);
    model.phase = "denied";
    expect(admittedQianzaiBindings(model, [binding])).toEqual([]);
  });
  it("rejects a stale verified view before fetching and routes a verified 403 through owner revocation", async () => {
    const f = fixture();
    let model = f.model;
    const abort = new AbortController();
    let allowed = true;
    const revoke = vi.fn(() => {
      allowed = false;
      abort.abort();
    });
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            schemaVersion: "quizforge.consumer-error.v1",
            code: "SOURCE_REJECTED",
            requestId: "11111111-1111-4111-8111-111111111111",
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
    );
    const port = createConsumerResourcePortV2({
      sessionId: "11111111-1111-4111-8111-111111111111",
      getSnapshot: () => model,
      task: () => ({ signal: abort.signal, current: () => allowed }),
      revoke,
      fetcher,
    });
    const lease = port.capture(model.entry!)!;
    model = { ...model, phase: "unknown", pendingOperation: "save" };
    expect(lease.current()).toBe(true);
    expect(lease.getSnapshot()).toBe(model);
    expect(lease.getSnapshot().pendingOperation).toBe("save");
    expect(lease.model.pendingOperation).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    model = { ...model, entry: structuredClone(model.entry) };
    await expect(
      lease.transport(
        f.asset,
        new AbortController().signal,
        performance.now() + 1000,
      ),
    ).rejects.toThrow("CONSUMER_RESOURCE_SCOPE_CHANGED");
    expect(fetcher).not.toHaveBeenCalled();
    const fresh = port.capture(model.entry!)!;
    await expect(
      fresh.transport(
        f.asset,
        new AbortController().signal,
        performance.now() + 1000,
      ),
    ).rejects.toBeDefined();
    expect(revoke).toHaveBeenCalledOnce();
    expect(fresh.current()).toBe(false);
  });
  it("releases a late completion and synchronously clears adopted URLs on authority loss", async () => {
    const { model, binding } = fixture();
    const abort = new AbortController();
    const lease: ConsumerResourceLeaseV2 = {
      generation: 1,
      model,
      getSnapshot: () => model,
      view: model.entry!,
      signal: abort.signal,
      current: () => !abort.signal.aborted,
      transport: vi.fn(),
    };
    let finish!: (image: VerifiedImage) => void;
    const release = vi.fn();
    const loader = vi.fn(
      () =>
        new Promise<VerifiedImage>((r) => {
          finish = r;
        }),
    );
    const owner = new QianzaiResourceOwner(lease, loader);
    const pending = owner.load(admittedQianzaiBindings(model, [binding]));
    abort.abort();
    finish({ url: "blob:late", image: {} as HTMLImageElement, release });
    await pending;
    expect(release).toHaveBeenCalledOnce();
    expect(owner.getSnapshot()).toEqual([]);
    const active = new AbortController(),
      releaseNow = vi.fn();
    const second = new QianzaiResourceOwner(
      {
        ...lease,
        signal: active.signal,
        current: () => !active.signal.aborted,
      },
      async () => ({
        url: "blob:owned",
        image: {} as HTMLImageElement,
        release: releaseNow,
      }),
    );
    await second.load(admittedQianzaiBindings(model, [binding]));
    expect(second.getSnapshot()).toHaveLength(1);
    active.abort();
    expect(releaseNow).toHaveBeenCalledOnce();
    expect(second.getSnapshot()).toEqual([]);
  });
  it("revokes the resource generation on a verified KEY_NOT_ACTIVE response without a business POST", async () => {
    const { model, asset } = fixture();
    const abort = new AbortController();
    const revoke = vi.fn(() => abort.abort());
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            schemaVersion: "quizforge.consumer-error.v1",
            code: "KEY_NOT_ACTIVE",
            requestId: "11111111-1111-4111-8111-111111111111",
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
    );
    const port = createConsumerResourcePortV2({
      sessionId: "11111111-1111-4111-8111-111111111111",
      getSnapshot: () => model,
      task: () => ({
        signal: abort.signal,
        current: () => !abort.signal.aborted,
      }),
      revoke,
      fetcher,
    });
    const lease = port.capture(model.entry!)!;
    await expect(
      lease.transport(
        asset,
        new AbortController().signal,
        performance.now() + 1000,
      ),
    ).rejects.toBeDefined();
    expect(revoke).toHaveBeenCalledOnce();
    expect(lease.current()).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]?.method).toBeUndefined();
  });
});

it("admits navigation only at its declared act slot and never confuses it with the new background", () => {
  const { model, asset } = fixture();
  const act = model.entry!.slots.acts[0]!;
  act.navigation = asset.resourceRef;
  const { alt: _alt, ...facts } = asset;
  void _alt;
  const binding: QianzaiAssetBinding = {
    asset: facts,
    slot: "acts.0.navigation",
    layer: "prototype-scene-base",
  };
  expect(admittedQianzaiBindings(model, [binding])).toHaveLength(1);
  expect(
    admittedQianzaiBindings(model, [{ ...binding, slot: "acts.1.navigation" }]),
  ).toEqual([]);
  delete act.navigation;
  expect(admittedQianzaiBindings(model, [binding])).toEqual([]);
});

function completedResources() {
  const { completed: model } = structuredReaderFixtureV2();
  const character = model.report!.view.display.slots.character!;
  const base = fixture().asset;
  const reveal = {
    asset: { ...base, resourceRef: character.reveal },
    layer: "clean" as const,
    slot: "character.reveal" as const,
  };
  const name = {
    asset: { ...base, resourceRef: character.nameArt },
    layer: "clean" as const,
    slot: "character.nameArt" as const,
  };
  const paper = {
    asset: base,
    layer: "clean" as const,
    slot: "acts.0.questionPaper" as const,
  };
  const abort = new AbortController();
  const lease: ConsumerResourceLeaseV2 = {
    generation: 1,
    model,
    getSnapshot: () => model,
    view: model.report!.view,
    signal: abort.signal,
    current: () => !abort.signal.aborted,
    transport: vi.fn(),
  };
  return { model, reveal, name, paper, abort, lease };
}

it("starts the selected reveal and name before shared report assets with at most two loads", async () => {
  const f = completedResources();
  const finish: Array<(image: VerifiedImage) => void> = [];
  const loader = vi.fn(
    () => new Promise<VerifiedImage>((resolve) => finish.push(resolve)),
  );
  const owner = new QianzaiResourceOwner(f.lease, loader);
  const work = owner.load([f.paper, f.reveal, f.name]);
  expect(loader).toHaveBeenCalledTimes(2);
  expect(loader).toHaveBeenNthCalledWith(
    1,
    f.reveal.asset,
    f.lease.transport,
    expect.any(AbortSignal),
  );
  expect(loader).toHaveBeenNthCalledWith(
    2,
    f.name.asset,
    f.lease.transport,
    expect.any(AbortSignal),
  );
  const release = vi.fn();
  finish[0]!({ url: "blob:reveal", image: {} as HTMLImageElement, release });
  await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(3));
  expect(owner.getSnapshot().map((i) => i.slot)).toEqual(["character.reveal"]);
  f.abort.abort();
  finish[1]!({ url: "blob:late-name", image: {} as HTMLImageElement, release });
  finish[2]!({
    url: "blob:late-paper",
    image: {} as HTMLImageElement,
    release,
  });
  await work;
  expect(release).toHaveBeenCalledTimes(3);
  expect(owner.getSnapshot()).toEqual([]);
});

it("shares an exact decoded asset across report slots, releases once and never crosses a lease", async () => {
  const f = completedResources();
  const release = vi.fn();
  const loader = vi.fn(async () => ({
    url: "blob:shared",
    image: {} as HTMLImageElement,
    release,
  }));
  const bindings = [
    f.paper,
    { ...f.paper, slot: "acts.1.questionPaper" as const },
    { ...f.paper, slot: "acts.2.questionPaper" as const },
  ];
  const owner = new QianzaiResourceOwner(f.lease, loader);
  await owner.load(bindings);
  expect(loader).toHaveBeenCalledOnce();
  expect(owner.getSnapshot().map((i) => i.slot)).toEqual(
    bindings.map((b) => b.slot),
  );
  expect(new Set(owner.getSnapshot().map((i) => i.objectUrl)).size).toBe(1);
  const second = completedResources();
  const other = new QianzaiResourceOwner(second.lease, loader);
  await other.load(bindings);
  expect(loader).toHaveBeenCalledTimes(2);
  f.abort.abort();
  owner.dispose();
  expect(release).toHaveBeenCalledOnce();
  expect(other.getSnapshot()).toHaveLength(3);
  second.abort.abort();
  expect(release).toHaveBeenCalledTimes(2);
});

it("does not merge equal hashes with different resource facts or pending entry slots", async () => {
  const f = completedResources();
  const loader = vi.fn(async (_asset: typeof f.paper.asset) => ({
    url: "blob:verified",
    image: {} as HTMLImageElement,
    release: vi.fn(),
  }));
  const changedRef = {
    ...f.paper,
    asset: {
      ...f.paper.asset,
      resourceRef: { ...f.paper.asset.resourceRef, id: "different-ref" },
    },
  };
  const changedWidth = {
    ...f.paper,
    asset: { ...f.paper.asset, width: f.paper.asset.width + 1 },
  };
  const owner = new QianzaiResourceOwner(f.lease, loader);
  await owner.load([f.paper, changedRef, changedWidth]);
  expect(loader).toHaveBeenCalledTimes(3);
  f.abort.abort();
  const pending = completedResources();
  pending.model.pendingOperation = "complete";
  const entryOwner = new QianzaiResourceOwner(pending.lease, loader);
  await entryOwner.load([pending.paper, pending.paper, pending.reveal]);
  expect(loader).toHaveBeenCalledTimes(6);
  expect(loader.mock.calls[3]?.[0]).toEqual(pending.paper.asset);
  pending.abort.abort();
});
