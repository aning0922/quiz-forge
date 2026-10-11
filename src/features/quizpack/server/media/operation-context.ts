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

type ImageState = { deadline: number; timer: NodeJS.Timeout | null };
type State = {
  context: MediaOperationContext;
  controller: AbortController;
  externalSignal: AbortSignal;
  abort: () => void;
  timer: NodeJS.Timeout | null;
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
function stopAt(
  state: State,
  reason: MediaStopReason,
  trigger: number,
  cleanupDeadlineMonotonicMs?: number,
) {
  const cleanupDeadline = Math.min(
    trigger + MEDIA_LIMITS.cleanupMs,
    cleanupDeadlineMonotonicMs ?? Infinity,
  );
  if (!state.stop) {
    state.stop = Object.freeze({
      reason,
      stopStartedMonotonicMs: trigger,
      cleanupDeadlineMonotonicMs: cleanupDeadline,
    });
    if (state.timer) clearTimeout(state.timer);
    if (state.image?.timer) clearTimeout(state.image.timer);
    // Publish the stop state before synchronous AbortSignal listeners run.
    state.controller.abort();
  } else if (cleanupDeadline < state.stop.cleanupDeadlineMonotonicMs) {
    state.stop = Object.freeze({
      ...state.stop,
      cleanupDeadlineMonotonicMs: cleanupDeadline,
    });
  }
}
/** Use the scheduled deadline, even if the event loop observes it much later. */
function observe(
  state: State,
  now = performance.now(),
  cleanupDeadlineMonotonicMs?: number,
): void {
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
      cleanupDeadlineMonotonicMs,
    );
  else if (state.externalSignal.aborted)
    stopAt(state, "CANCELLED", now, cleanupDeadlineMonotonicMs);
}

// Native timers can arrive early after fractional delay truncation. Each rearm
// retains the same absolute deadline; it never grants another execution budget.
const timerDelay = (deadline: number) =>
  Math.min(2_147_483_647, Math.max(1, Math.ceil(deadline - performance.now())));
function armBusinessDeadline(state: State) {
  state.timer = setTimeout(() => {
    observe(state);
    if (!state.stop && !state.disposed) armBusinessDeadline(state);
  }, timerDelay(state.context.deadlineMonotonicMs));
  state.timer.unref?.();
}
function armImageDeadline(state: State, image: ImageState) {
  image.timer = setTimeout(() => {
    observe(state);
    if (!state.stop && !state.disposed && state.image === image)
      armImageDeadline(state, image);
  }, timerDelay(image.deadline));
  image.timer.unref?.();
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
  const state: State = {
    context,
    controller,
    externalSignal: input.signal,
    abort,
    timer: null,
    stop: null,
    image: null,
    disposed: false,
  };
  states.set(context, state);
  input.signal.addEventListener("abort", abort, { once: true });
  observe(state);
  if (!state.stop) armBusinessDeadline(state);
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
  const now = performance.now();
  observe(state, now, cleanupDeadlineMonotonicMs);
  stopAt(state, reason, now, cleanupDeadlineMonotonicMs);
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
  if (state.timer) clearTimeout(state.timer);
  if (state.image?.timer) clearTimeout(state.image.timer);
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
  const image: ImageState = { deadline, timer: null };
  state.image = image;
  armImageDeadline(state, image);
  return {
    deadlineMonotonicMs: deadline,
    // In-flight cleanup still has the authoritative state after public disposal.
    readState: () => snapshot(state),
    finish() {
      observe(state);
      if (state.image !== image) return;
      if (image.timer) clearTimeout(image.timer);
      state.image = null;
    },
  };
}
