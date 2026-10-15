import { DRAFT_LIMITS } from "@/features/product/drafts/contracts";
export type DraftResponseBudget = {
  signal: AbortSignal;
  deadlineMonotonicMs: number;
};
/** Production supplies the fetch's original deadline and signal, not a fresh body budget. */
export async function readBoundedDraftJson(
  response: Response,
  maximumBytes: number,
  budget?: DraftResponseBudget,
): Promise<unknown> {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > DRAFT_LIMITS.revisionResponseBytes ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      response.headers.get("content-type") ?? "",
    ) ||
    !response.body
  )
    throw new Error("INVALID_DRAFT_RESPONSE");
  const reader = response.body.getReader(),
    deadline = budget?.deadlineMonotonicMs ?? performance.now() + 15_000;
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    try {
      void reader.cancel().catch(() => undefined);
    } catch {
      /* Keep the finite error. */
    }
  };
  const checkpoint = () => {
    if (
      !Number.isFinite(deadline) ||
      performance.now() >= deadline ||
      budget?.signal.aborted
    )
      throw new Error("INVALID_DRAFT_RESPONSE");
  };
  let timer: ReturnType<typeof setTimeout> | undefined,
    abort: (() => void) | undefined;
  const bytes = new Uint8Array(maximumBytes);
  let length = 0,
    reads = 0;
  try {
    checkpoint();
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => {
        cancel();
        reject(new Error("INVALID_DRAFT_RESPONSE"));
      };
      budget?.signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(abort, Math.max(1, deadline - performance.now()));
      if (budget?.signal.aborted) abort();
    });
    for (;;) {
      checkpoint();
      if (reads > 0 && reads % 32 === 0) {
        await Promise.race([
          new Promise<void>((resolve) => setTimeout(resolve, 0)),
          interrupted,
        ]);
        checkpoint();
      }
      const chunk = await Promise.race([reader.read(), interrupted]);
      checkpoint();
      reads++;
      if (chunk.done) break;
      if (chunk.value.byteLength > maximumBytes - length)
        throw new Error("INVALID_DRAFT_RESPONSE");
      bytes.set(chunk.value, length);
      length += chunk.value.byteLength;
    }
    const result: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, length),
      ),
    );
    checkpoint();
    return result;
  } catch {
    cancel();
    throw new Error("INVALID_DRAFT_RESPONSE");
  } finally {
    clearTimeout(timer);
    if (abort) budget?.signal.removeEventListener("abort", abort);
    try {
      reader.releaseLock();
    } catch {
      /* A failed body cannot confer success. */
    }
  }
}
