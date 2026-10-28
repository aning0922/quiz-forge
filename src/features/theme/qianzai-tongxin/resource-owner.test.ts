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
import { QIANZAI_RUNTIME_INPUTS } from "./runtime-inputs";
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
    expect(QIANZAI_RUNTIME_INPUTS.resources).toHaveLength(14);
    expect(
      new Set(QIANZAI_RUNTIME_INPUTS.resources.map((b) => b.slot)).size,
    ).toBe(14);
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
