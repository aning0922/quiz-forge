import { describe, expect, it, vi } from "vitest";
import {
  createReceiveSource,
  cancelWithinHttpBudget,
  assertArchiveHeaders,
} from "./receive-source";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function reader() {
  return {
    read: vi.fn(async (): Promise<ReadableStreamReadResult<Uint8Array>> => ({
      done: true,
      value: undefined,
    })),
    cancel: vi.fn(async (): Promise<void> => undefined),
    releaseLock: vi.fn(),
  };
}

describe("raw HTTP receive source", () => {
  it("requires raw identity bytes, rejects range and ignores declared length", () => {
    for (const headers of [
      { "content-type": "multipart/form-data" },
      {
        "content-type": "application/octet-stream",
        "content-encoding": "gzip",
      },
      { "content-type": "application/octet-stream", range: "bytes=0-1" },
      {
        "content-type": "application/octet-stream",
        "content-range": "bytes 0-1/2",
      },
    ])
      expect(() => assertArchiveHeaders(new Headers(headers))).toThrow(
        "INVALID_REQUEST",
      );
    expect(() =>
      assertArchiveHeaders(
        new Headers({
          "content-type": "application/octet-stream",
          "content-length": "1",
        }),
      ),
    ).not.toThrow();
  });
  it("does not read before service iteration and cancels an unstarted generator once", async () => {
    const body = reader();
    const source = createReceiveSource(body);
    expect(body.read).not.toHaveBeenCalled();
    const first = source.cancel();
    expect(source.cancel()).toBe(first);
    await first;
    expect(body.cancel).toHaveBeenCalledTimes(1);
    expect(body.releaseLock).toHaveBeenCalledTimes(1);
    for await (const chunk of source.chunks) expect(chunk).toBeUndefined();
    expect(body.read).not.toHaveBeenCalled();
  });
  it("waits for both cancel and an in-flight read before releasing the lock", async () => {
    const read = deferred<ReadableStreamReadResult<Uint8Array>>();
    const stop = deferred<void>();
    const body = reader();
    body.read.mockImplementation(() => read.promise);
    body.cancel.mockImplementation(() => stop.promise);
    const source = createReceiveSource(body);
    const next = source.chunks[Symbol.asyncIterator]().next();
    const cancellation = source.cancel();
    stop.resolve();
    await Promise.resolve();
    expect(body.releaseLock).not.toHaveBeenCalled();
    read.resolve({ done: false, value: new Uint8Array([1]) });
    await cancellation;
    expect((await next).done).toBe(true);
    expect(body.releaseLock).toHaveBeenCalledTimes(1);
  });
  it("releases at EOF without cancelling a finished stream", async () => {
    const body = reader();
    body.read.mockResolvedValueOnce({
      done: false,
      value: new Uint8Array([7]),
    });
    const source = createReceiveSource(body);
    const received: number[] = [];
    for await (const chunk of source.chunks) received.push(...chunk);
    await source.cancel();
    expect(received).toEqual([7]);
    expect(body.cancel).not.toHaveBeenCalled();
    expect(body.releaseLock).toHaveBeenCalledTimes(1);
  });
  it("bounds hung cleanup to one second and observes late rejection", async () => {
    vi.useFakeTimers();
    try {
      const stop = deferred<void>();
      const body = reader();
      body.cancel.mockImplementation(() => stop.promise);
      const source = createReceiveSource(body);
      const cleanup = cancelWithinHttpBudget(source.cancel);
      await vi.advanceTimersByTimeAsync(1000);
      await cleanup;
      expect(body.releaseLock).not.toHaveBeenCalled();
      stop.reject(new Error("synthetic cancellation failure"));
      await Promise.resolve();
      await expect(source.cancel()).rejects.toThrow(
        "synthetic cancellation failure",
      );
      expect(body.cancel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("preserves rejected cancellation as failure rather than stopped proof", async () => {
    const body = reader();
    body.cancel.mockRejectedValue(new Error("synthetic failure"));
    const source = createReceiveSource(body);
    await cancelWithinHttpBudget(source.cancel);
    await expect(source.cancel()).rejects.toThrow("synthetic failure");
    expect(body.releaseLock).not.toHaveBeenCalled();
  });
});
