import "server-only";
import { performance } from "node:perf_hooks";
import type { DatabaseBudget } from "@/lib/db/client";
import { StudioError } from "./errors";

export const STUDIO_REQUEST_DEADLINE_MS = 15_000;

/** One absolute handler budget; the caller must still await its exclusive DB close. */
export function createStudioRequestBudget(
  requestSignal: AbortSignal,
  startedAt = performance.now(),
) {
  const controller = new AbortController();
  const now = performance.now();
  const deadlineMonotonicMs = startedAt + STUDIO_REQUEST_DEADLINE_MS;
  if (
    !Number.isFinite(startedAt) ||
    startedAt < 0 ||
    startedAt > now ||
    !Number.isFinite(deadlineMonotonicMs)
  )
    throw new StudioError("INVALID_REQUEST");
  const abort = () => controller.abort();
  requestSignal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, Math.max(0, deadlineMonotonicMs - now));
  timer.unref?.();
  if (requestSignal.aborted || deadlineMonotonicMs <= now) abort();
  const budget: DatabaseBudget = Object.freeze({
    signal: controller.signal,
    deadlineMonotonicMs,
  });
  return {
    budget,
    checkpoint() {
      if (
        controller.signal.aborted ||
        performance.now() >= deadlineMonotonicMs
      ) {
        abort();
        throw new StudioError("STUDIO_UNAVAILABLE");
      }
    },
    dispose() {
      clearTimeout(timer);
      requestSignal.removeEventListener("abort", abort);
    },
  };
}
