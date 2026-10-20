import { DISPLAY_LIMITS_V1 } from "@/lib/assessment-contract/display-limits-v1";

/** Legacy observable codes are preserved; this class grants no application authority. */
export class DisplayClientError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export async function withDisplayDeadline<T>(
  signal: AbortSignal,
  task: (signal: AbortSignal, deadline: number) => Promise<T>,
  deadlineMonotonicMs = Infinity,
): Promise<T> {
  const controller = new AbortController(),
    deadline = Math.min(
      performance.now() + DISPLAY_LIMITS_V1.deadlineMs,
      deadlineMonotonicMs,
    );
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, Math.max(0, deadline - performance.now()));
  try {
    checkpoint(controller.signal, deadline);
    const result = await task(controller.signal, deadline);
    checkpoint(controller.signal, deadline);
    return result;
  } catch (error) {
    if (error instanceof DisplayClientError) throw error;
    throw new DisplayClientError(
      signal.aborted
        ? "PREVIEW_CANCELLED"
        : controller.signal.aborted
          ? "PREVIEW_TIMEOUT"
          : "STUDIO_UNAVAILABLE",
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    controller.abort();
  }
}
export function checkpoint(signal: AbortSignal, deadline = Infinity) {
  if (signal.aborted) throw new DisplayClientError("PREVIEW_CANCELLED");
  if (performance.now() >= deadline)
    throw new DisplayClientError("PREVIEW_TIMEOUT");
}
export async function awaitDisplayTask<T>(
  task: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        abort = () => reject(new DisplayClientError("PREVIEW_CANCELLED"));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}
