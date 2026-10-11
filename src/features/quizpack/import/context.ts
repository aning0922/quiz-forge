import "server-only";
import { StudioError } from "@/lib/http-security/errors";
import { RECEIVE_TIMEOUT_MS } from "./limits";
import type { ReceiveContext } from "./service-contract";
/** Call at handler entry, before authentication. Caller disposes in finally. */
export function createReceiveContext(
  requestSignal: AbortSignal,
  startedAt = performance.now(),
): { context: ReceiveContext; dispose: () => void } {
  const controller = new AbortController();
  const deadlineMonotonicMs = startedAt + RECEIVE_TIMEOUT_MS;
  const abort = () => controller.abort();
  requestSignal.addEventListener("abort", abort, { once: true });
  if (requestSignal.aborted) abort();
  const timer = setTimeout(
    abort,
    Math.max(0, deadlineMonotonicMs - performance.now()),
  );
  timer.unref?.();
  return {
    context: { signal: controller.signal, deadlineMonotonicMs },
    dispose: () => {
      clearTimeout(timer);
      requestSignal.removeEventListener("abort", abort);
    },
  };
}
export function remainingReceiveMs(context: ReceiveContext): number {
  const remaining = context.deadlineMonotonicMs - performance.now();
  if (!Number.isFinite(remaining) || remaining <= 0 || context.signal.aborted)
    throw new StudioError("RECEIVE_TIMEOUT");
  return remaining;
}
