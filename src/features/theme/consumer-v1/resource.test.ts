import { expect, it, vi } from "vitest";
import { consumerResourceTransportV1 } from "./resource";
import type { DisplayAssetV1 } from "@/lib/assessment-contract/display-v1";
const asset: DisplayAssetV1 = {
  resourceRef: { productId: "synthetic", id: "scene", version: "1.0.0" },
  mediaType: "image/png",
  bytes: 2,
  sha256: "a".repeat(64),
  width: 1,
  height: 1,
  purpose: "cover",
  approval: "pending",
  alt: "合成像素",
};
const sessionId = "11111111-1111-4111-8111-111111111111";
it("bounds actual bytes and aggregates arbitrary empty network chunks into one decoder chunk", async () => {
  for (const count of [128, 8192]) {
    let reads = 0,
      maximum = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          if (reads++ < count) c.enqueue(new Uint8Array());
          else {
            c.enqueue(new Uint8Array([1, 2]));
            c.close();
          }
        },
      }),
      { headers: { "content-type": "image/png", "content-length": "0" } },
    );
    const original = Promise.prototype.then,
      counts = new WeakMap<Promise<unknown>, number>();
    Promise.prototype.then = function (
      this: Promise<unknown>,
      ...args: Parameters<typeof original>
    ) {
      const n = (counts.get(this) ?? 0) + 1;
      counts.set(this, n);
      maximum = Math.max(maximum, n);
      return original.apply(this, args);
    } as typeof original;
    const signal = new AbortController().signal;
    let result: Response;
    try {
      result = await consumerResourceTransportV1(
        sessionId,
        { signal, current: () => true },
        () => {},
        async () => response,
      )(asset, signal, performance.now() + 4500);
    } finally {
      Promise.prototype.then = original;
    }
    expect(maximum).toBeLessThanOrEqual(4);
    const reader = result!.body!.getReader();
    expect((await reader.read()).value).toEqual(new Uint8Array([1, 2]));
    expect((await reader.read()).done).toBe(true);
  }
});
it("rejects +1, short and wrong-type bodies without returning a decode URL", async () => {
  const signal = new AbortController().signal;
  for (const response of [
    new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/png" },
    }),
    new Response(new Uint8Array([1]), {
      headers: { "content-type": "image/png" },
    }),
    new Response(new Uint8Array([1, 2]), {
      headers: { "content-type": "image/jpeg" },
    }),
  ])
    await expect(
      consumerResourceTransportV1(
        sessionId,
        { signal, current: () => true },
        () => {},
        async () => response,
      )(asset, signal, performance.now() + 1000),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
});
it("a verified access error synchronously revokes the shared authority", async () => {
  const signal = new AbortController().signal,
    revoke = vi.fn();
  const response = new Response(
    JSON.stringify({
      schemaVersion: "quizforge.consumer-error.v1",
      code: "ACCESS_DENIED",
      requestId: sessionId,
    }),
    { status: 401, headers: { "content-type": "application/json" } },
  );
  await expect(
    consumerResourceTransportV1(
      sessionId,
      { signal, current: () => true },
      revoke,
      async () => response,
    )(asset, signal, performance.now() + 1000),
  ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  expect(revoke).toHaveBeenCalledOnce();
});
it("cancels a stalled binary body under its original deadline without awaiting cancellation", async () => {
  const signal = new AbortController().signal,
    cancelled = vi.fn(() => new Promise<void>(() => {}));
  const response = new Response(new ReadableStream({ cancel: cancelled }), {
    headers: { "content-type": "image/png" },
  });
  await expect(
    consumerResourceTransportV1(
      sessionId,
      { signal, current: () => true },
      () => {},
      async () => response,
    )(asset, signal, performance.now() + 15),
  ).rejects.toMatchObject({ code: "TIMEOUT" });
  expect(cancelled).toHaveBeenCalledOnce();
});
