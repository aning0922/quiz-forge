import { afterEach, describe, expect, it, vi } from "vitest";
import { requestConsumerJson } from "./request";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";

const signal = () => new AbortController().signal;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
function read(fetcher: typeof fetch, extra = {}) {
  return requestConsumerJson(
    "/play/test/api/session",
    {
      method: "GET",
      maximum: 4096,
      statuses: [200],
      signal: signal(),
      fetcher,
      ...extra,
    },
    (v) => v,
  );
}
afterEach(() => vi.useRealTimers());
describe("consumer browser bounded transport", () => {
  it("uses same-origin/no-store/redirect rejection and verifies before delivery", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json({ fact: 1 }));
    const result = await requestConsumerJson(
      "/play/test/api/save",
      {
        method: "POST",
        body: { candidate: 1 },
        csrf: "synthetic",
        maximum: 4096,
        statuses: [200],
        signal: signal(),
        fetcher,
      },
      (value) => ({ verified: value }),
    );
    expect(result).toEqual({ verified: { fact: 1 } });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-quizforge-consumer-csrf": "synthetic",
      },
    });
  });
  it("revokes authority on a verified denied fact but never leaks arbitrary errors", async () => {
    const revoke = vi.fn();
    const error = {
      schemaVersion: "quizforge.consumer-error.v1",
      code: "ACCESS_DENIED",
      requestId: "11111111-1111-4111-8111-111111111111",
    };
    await expect(
      read(async () => json(error, 401), { onAuthorityFailure: revoke }),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(revoke).toHaveBeenCalledOnce();
    for (const response of [
      json(error, 503),
      json({ ...error, secret: "private" }, 401),
      new Response("secret stack", { status: 500 }),
    ])
      await expect(read(async () => response)).rejects.toMatchObject({
        code: "UNAVAILABLE",
        message: "UNAVAILABLE",
      });
  });
  it("counts actual bytes and rejects invalid UTF8, deep JSON and encoded bodies", async () => {
    for (const response of [
      new Response(new Uint8Array([0xff]), {
        headers: { "content-type": "application/json" },
      }),
      new Response("[".repeat(33) + "0" + "]".repeat(33), {
        headers: { "content-type": "application/json" },
      }),
      new Response("{}", {
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
        },
      }),
      json({ tooLong: "x".repeat(5000) }),
    ])
      await expect(read(async () => response)).rejects.toMatchObject({
        code: "UNAVAILABLE",
      });
    expect(
      await read(
        async () =>
          new Response("{}", {
            headers: {
              "content-type": "application/json",
              "content-length": "0",
            },
          }),
      ),
    ).toEqual({});
  });
  it("has one interruption reaction independent of empty stream count", async () => {
    const maxima: number[] = [];
    for (const count of [128, 8192]) {
      let pulls = 0,
        maximum = 0;
      const response = new Response(
        new ReadableStream<Uint8Array>({
          pull(c) {
            if (pulls++ < count) c.enqueue(new Uint8Array());
            else {
              c.enqueue(new TextEncoder().encode("{}"));
              c.close();
            }
          },
        }),
        { headers: { "content-type": "application/json" } },
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
      try {
        expect(await read(async () => response)).toEqual({});
      } finally {
        Promise.prototype.then = original;
      }
      maxima.push(maximum);
    }
    expect(maxima).toEqual([1, 1]);
  });
  it("aborts a stalled body and does not await uncooperative cancellation", async () => {
    const controller = new AbortController(),
      cancelled = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(
      new ReadableStream<Uint8Array>({ cancel: cancelled }),
      { headers: { "content-type": "application/json" } },
    );
    const result = read(async () => response, { signal: controller.signal });
    await new Promise<void>((r) => setImmediate(r));
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it("bounds an uncooperative fetch/verification with the original single deadline", async () => {
    vi.useFakeTimers();
    const result = read(() => new Promise<Response>(() => {}));
    const failed = expect(result).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(L.deadlineMs);
    await failed;
    const controller = new AbortController();
    let release!: () => void;
    const verify = vi.fn(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    const pending = requestConsumerJson(
      "/play/test/api/session",
      {
        method: "GET",
        maximum: 100,
        statuses: [200],
        signal: controller.signal,
        fetcher: async () => json({}),
      },
      verify,
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
    release();
    await vi.advanceTimersByTimeAsync(0);
  });
  it("rejects cross-origin and backslash URLs before fetch", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const url of [
      "https://other.invalid",
      "//other.invalid",
      "/\\other.invalid",
      "/api#raw",
    ])
      await expect(
        requestConsumerJson(
          url,
          {
            method: "GET",
            maximum: 100,
            statuses: [200],
            signal: signal(),
            fetcher,
          },
          (v) => v,
        ),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
