import "server-only";
import { performance } from "node:perf_hooks";
import {
  MEDIA_LIMITS,
  MEDIA_STOP_REASONS,
  type MediaOperationContext,
  type MediaOperationState,
  type MediaStopReason,
  type MediaStopState,
} from "./contracts";

type ImageState = { deadline: number; timer: NodeJS.Timeout };
type State = {
  context: MediaOperationContext;
  controller: AbortController;
  externalSignal: AbortSignal;
  abort: () => void;
  timer: NodeJS.Timeout;
  stop: MediaStopState | null;
  image: ImageState | null;
  disposed: boolean;
};
const states = new WeakMap<MediaOperationContext, State>();
export class MediaOperationContextError extends Error {
  constructor() {
    super("INVALID_MEDIA_OPERATION_CONTEXT");
  }
}
function getState(context: MediaOperationContext): State {
  const state = states.get(context);
  if (!state || state.disposed) throw new MediaOperationContextError();
  return state;
}
function stopAt(state: State, reason: MediaStopReason, trigger: number) {
  if (!state.stop) {
    state.stop = Object.freeze({
      reason,
      stopStartedMonotonicMs: trigger,
      cleanupDeadlineMonotonicMs: trigger + MEDIA_LIMITS.cleanupMs,
    });
    clearTimeout(state.timer);
    if (state.image) clearTimeout(state.image.timer);
    // Publish the stop state before synchronous AbortSignal listeners run.
    state.controller.abort();
  }
}
/** Use the scheduled deadline, even if the event loop observes it much later. */
function observe(state: State, now = performance.now()): void {
  const business = state.context.deadlineMonotonicMs;
  const image = state.image?.deadline ?? Infinity;
  const earliest = Math.min(business, image);
  if (now >= earliest)
    stopAt(
      state,
      business <= image
        ? "BUSINESS_DEADLINE_EXCEEDED"
        : "IMAGE_DEADLINE_EXCEEDED",
      earliest,
    );
  else if (state.externalSignal.aborted) stopAt(state, "CANCELLED", now);
}

export function createMediaOperationContext(input: {
  signal: AbortSignal;
  deadlineMonotonicMs: number;
}): MediaOperationContext {
  if (
    !(input.signal instanceof AbortSignal) ||
    !Number.isFinite(input.deadlineMonotonicMs) ||
    input.deadlineMonotonicMs < 0
  )
    throw new MediaOperationContextError();
  const controller = new AbortController();
  const context = Object.freeze({
    signal: controller.signal,
    deadlineMonotonicMs: input.deadlineMonotonicMs,
  }) as MediaOperationContext;
  const abort = () => observe(state);
  const timer = setTimeout(
    abort,
    Math.max(0, input.deadlineMonotonicMs - performance.now()),
  );
  timer.unref?.();
  const state: State = {
    context,
    controller,
    externalSignal: input.signal,
    abort,
    timer,
    stop: null,
    image: null,
    disposed: false,
  };
  states.set(context, state);
  input.signal.addEventListener("abort", abort, { once: true });
  observe(state);
  return context;
}

function snapshot(state: State): MediaOperationState {
  observe(state);
  const base = {
    signal: state.context.signal,
    deadlineMonotonicMs: state.context.deadlineMonotonicMs,
  };
  return state.stop
    ? Object.freeze({ ...base, phase: "stopping", stop: state.stop })
    : Object.freeze({ ...base, phase: "active" });
}

export function readMediaOperationState(
  context: MediaOperationContext,
): MediaOperationState {
  return snapshot(getState(context));
}

export function requestMediaOperationStop(
  context: MediaOperationContext,
  reason: MediaStopReason,
  cleanupDeadlineMonotonicMs?: number,
): MediaStopState {
  const state = getState(context);
  if (
    !MEDIA_STOP_REASONS.includes(reason) ||
    (cleanupDeadlineMonotonicMs !== undefined &&
      !Number.isFinite(cleanupDeadlineMonotonicMs))
  )
    throw new MediaOperationContextError();
  observe(state);
  stopAt(state, reason, performance.now());
  const stop = state.stop!;
  if (
    cleanupDeadlineMonotonicMs !== undefined &&
    cleanupDeadlineMonotonicMs < stop.cleanupDeadlineMonotonicMs
  )
    state.stop = Object.freeze({ ...stop, cleanupDeadlineMonotonicMs });
  return state.stop!;
}

/** Caller disposes in finally after all related launch/file tasks have settled.
 * Disposal does not grant stop confirmation and never makes a context reusable. */
export function disposeMediaOperationContext(
  context: MediaOperationContext,
): void {
  const state = getState(context);
  observe(state);
  stopAt(state, "STOP_REQUESTED", performance.now());
  state.disposed = true;
  clearTimeout(state.timer);
  if (state.image) clearTimeout(state.image.timer);
  state.externalSignal.removeEventListener("abort", state.abort);
}

/** Internal single-image scope. Ordinary callers cannot choose execution limits. */
export function beginMediaImage(context: MediaOperationContext): {
  deadlineMonotonicMs: number;
  finish: () => void;
  readState: () => MediaOperationState;
} | null {
  const state = getState(context);
  observe(state);
  if (state.stop || state.image) return null;
  const deadline = Math.min(
    context.deadlineMonotonicMs,
    performance.now() + MEDIA_LIMITS.executionMs,
  );
  const image: ImageState = {
    deadline,
    timer: setTimeout(
      () => observe(state),
      Math.max(0, deadline - performance.now()),
    ),
  };
  image.timer.unref?.();
  state.image = image;
  return {
    deadlineMonotonicMs: deadline,
    // In-flight cleanup still has the authoritative state after public disposal.
    readState: () => snapshot(state),
    finish() {
      observe(state);
      if (state.image !== image) return;
      clearTimeout(image.timer);
      state.image = null;
    },
  };
}
