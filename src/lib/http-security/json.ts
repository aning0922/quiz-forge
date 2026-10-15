import "server-only";
import { performance } from "node:perf_hooks";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { StudioError } from "./errors";

export const JSON_BYTE_LIMIT = 4096;
export const JSON_DEADLINE_MS = 5000;

/** Read the actual stream; neither Content-Length nor a client timeout is trusted. */
export async function readStudioJson(
  request: Request,
  budget?: { signal: AbortSignal; deadlineMonotonicMs: number },
): Promise<unknown> {
  const expiresAt = Math.min(
    performance.now() + JSON_DEADLINE_MS,
    budget?.deadlineMonotonicMs ?? Infinity,
  );
  function checkDeadline(): void {
    if (
      !Number.isFinite(expiresAt) ||
      budget?.signal.aborted ||
      performance.now() >= expiresAt
    ) {
      throw new StudioError("INVALID_REQUEST");
    }
  }
  const type = request.headers.get("content-type");
  if (
    !type ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type) ||
    (request.headers.has("content-encoding") &&
      request.headers.get("content-encoding") !== "identity")
  ) {
    throw new StudioError("INVALID_REQUEST");
  }
  if (!request.body) throw new StudioError("INVALID_REQUEST");
  checkDeadline();
  const reader = request.body.getReader();
  function cancelReader(): void {
    // An untrusted stream's cancel callback may never settle or may throw.
    try {
      void reader.cancel().catch(() => undefined);
    } catch {
      // The stable rejection must not be replaced by a stream exception.
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    abort = () => {
      reject(new StudioError("INVALID_REQUEST"));
      cancelReader();
    };
    budget?.signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(abort, Math.max(0, expiresAt - performance.now()));
    if (budget?.signal.aborted) abort();
  });
  // A single fixed buffer also bounds retained state for zero-byte chunks.
  const bytes = new Uint8Array(JSON_BYTE_LIMIT);
  let length = 0;
  let reads = 0;
  try {
    while (true) {
      checkDeadline();
      // Resolved read promises can otherwise starve the deadline timer.
      if (reads > 0 && reads % 32 === 0) {
        await Promise.race([yieldToEventLoop(), deadline]);
        checkDeadline();
      }
      const part = await Promise.race([reader.read(), deadline]);
      checkDeadline();
      reads += 1;
      if (part.done) break;
      if (part.value.byteLength > JSON_BYTE_LIMIT - length) {
        throw new StudioError("PAYLOAD_TOO_LARGE");
      }
      if (part.value.byteLength > 0) {
        bytes.set(part.value, length);
        length += part.value.byteLength;
      }
    }
    checkDeadline();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, length),
    );
    checkDeadline();
    const value: unknown = JSON.parse(text);
    checkDeadline();
    return value;
  } catch (error) {
    cancelReader();
    if (error instanceof StudioError) throw error;
    throw new StudioError("INVALID_REQUEST");
  } finally {
    clearTimeout(timer);
    if (abort) budget?.signal.removeEventListener("abort", abort);
    try {
      reader.releaseLock();
    } catch {
      // Cleanup cannot turn a stable HTTP error into a raw stream exception.
    }
  }
}

export function emptyDto(value: unknown): void {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 0
  ) {
    throw new StudioError("INVALID_REQUEST");
  }
}

export function loginDto(value: unknown): { credential: string } {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !("credential" in value) ||
    typeof value.credential !== "string" ||
    value.credential.length > 128 ||
    value.credential.length === 0
  ) {
    throw new StudioError("INVALID_REQUEST");
  }
  return { credential: value.credential };
}
