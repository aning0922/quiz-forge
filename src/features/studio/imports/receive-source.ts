import "server-only";
import { StudioError } from "@/lib/http-security/errors";

export function assertArchiveHeaders(headers: Headers): void {
  if (
    headers.get("content-type")?.toLowerCase() !== "application/octet-stream" ||
    (headers.has("content-encoding") &&
      headers.get("content-encoding") !== "identity") ||
    headers.has("range") ||
    headers.has("content-range")
  )
    throw new StudioError("INVALID_REQUEST");
}

type BodyReader = Pick<
  ReadableStreamDefaultReader<Uint8Array>,
  "read" | "cancel" | "releaseLock"
>;

/** Own the reader immediately, but only the service's iteration may read it. */
export function createReceiveSource(reader: BodyReader) {
  let cancelled = false;
  let finished = false;
  let released = false;
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
  let cancellation: Promise<void> | undefined;
  function release() {
    if (!released) {
      reader.releaseLock();
      released = true;
    }
  }
  function cancel(): Promise<void> {
    if (cancellation) return cancellation;
    cancelled = true;
    // Keep this promise even if cancel throws synchronously; no second cancel.
    cancellation = (async () => {
      if (finished) {
        release();
        return;
      }
      const read = pending;
      await reader.cancel();
      // A resolved cancel alone is insufficient if a read is still in flight.
      if (read)
        await read.then(
          () => undefined,
          () => undefined,
        );
      release();
    })();
    // Observe late rejection even when the HTTP cleanup budget has expired.
    void cancellation.catch(() => undefined);
    return cancellation;
  }
  const chunks: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      if (cancelled || finished) return;
      try {
        while (!cancelled) {
          pending = reader.read();
          // Observe errors independently of an abandoned iterator consumer.
          void pending.catch(() => undefined);
          const part = await pending;
          pending = undefined;
          if (cancelled) return;
          if (part.done) {
            finished = true;
            release();
            return;
          }
          yield part.value;
        }
      } finally {
        // Do not await cancellation here: the service explicitly owns stopping.
        if (!finished) void cancel();
      }
    },
  };
  return { chunks, cancel };
}

/** Cleanup is bounded; resolution here is never used as proof of stopped IO. */
export async function cancelWithinHttpBudget(
  cancel: () => Promise<void>,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operation = Promise.resolve().then(cancel);
  void operation.catch(() => undefined);
  try {
    await Promise.race([
      operation.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
