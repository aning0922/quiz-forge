import "server-only";
import { performance } from "node:perf_hooks";
import {
  mediaStopFailureCode,
  readMediaOperationState,
  requestMediaOperationStop,
  type MediaOperationContext,
  type LaunchFailureCode,
} from "../media";
import type { QuizPackValidationReport } from "../../v1/api";
import type { CandidateInterruptionCode, MediaFact } from "./contracts";
export type ValidationCompletion = Readonly<{
  mediaStopped: "not-started" | "confirmed" | "unknown";
  relatedIo: "settled" | "unconfirmed";
  maintenanceRequired: boolean;
}>;
const CLEANUP_OBSERVATION_MS = 10;
export class ValidationInterrupted extends Error {
  report: QuizPackValidationReport | null = null;
  constructor(
    readonly code: CandidateInterruptionCode,
    readonly p1Code = "VALIDATION_FAILED",
  ) {
    super("Trusted validation interrupted.");
  }
}
export function createValidationOperationScope(context: MediaOperationContext) {
  const pendingIo = new Set<Promise<void>>();
  let runtimeFailure: LaunchFailureCode | null = null;
  let activeMedia = false,
    runtimeIoUnconfirmed = false;
  let relatedIo: "settled" | "unconfirmed" = "settled";
  const checkpoint = (): void => {
    let state;
    try {
      state = readMediaOperationState(context);
    } catch {
      throw new ValidationInterrupted("INVALID_CONTEXT");
    }
    if (state.phase === "stopping") {
      if (state.stop.reason === "STOP_UNCONFIRMED") {
        runtimeFailure = "STOP_UNCONFIRMED";
        runtimeIoUnconfirmed = true;
      } else runtimeFailure ??= mediaStopFailureCode(state.stop);
      throw new ValidationInterrupted(
        runtimeFailure === "STOP_UNCONFIRMED"
          ? "MEDIA_STOP_UNCONFIRMED"
          : runtimeFailure === "CANCELLED"
            ? "OPERATION_CANCELLED"
            : runtimeFailure === "DEADLINE_EXCEEDED"
              ? "OPERATION_TIMEOUT"
              : "MEDIA_RUNTIME_FAILED",
        runtimeFailure === "CANCELLED"
          ? "OPERATION_CANCELLED"
          : runtimeFailure === "DEADLINE_EXCEEDED"
            ? "OPERATION_TIMEOUT"
            : "MEDIA_WORKER_FAILED",
      );
    }
  };
  const requestStop = (unknownMedia = false): void => {
    try {
      requestMediaOperationStop(
        context,
        unknownMedia ? "STOP_UNCONFIRMED" : "RUNTIME_FAILED",
      );
    } catch {
      /* Invalid/disposed contexts cannot confer completion authority. */
    }
  };
  const trackIo = (task: Promise<void>): void => {
    pendingIo.add(task);
    const settled = () => {
      // Observe when proof is available, even if a delayed timer has not run.
      // A settled task after cleanup expiry must not erase the deadline fact.
      try {
        const state = readMediaOperationState(context);
        if (
          state.phase === "stopping" &&
          performance.now() >= state.stop.cleanupDeadlineMonotonicMs
        )
          relatedIo = "unconfirmed";
      } catch {
        relatedIo = "unconfirmed";
      }
      pendingIo.delete(task);
    };
    void task.then(settled, settled);
  };
  const awaitOperationTask = async <T>(task: Promise<T>): Promise<T> => {
    // Track the operation itself as well as native close. A close proof alone
    // cannot hide a callback still capable of continuing validation work.
    trackIo(
      task.then(
        () => undefined,
        () => undefined,
      ),
    );
    let timer: NodeJS.Timeout | undefined;
    let onAbort: () => void = () => {};
    const stopped = new Promise<never>((_, reject) => {
      const finish = () => {
        // This is a decision-time fact, not a later count of pending promises.
        // A late resolution in the same callback cannot revoke uncertainty.
        relatedIo = "unconfirmed";
        if (activeMedia) {
          runtimeFailure = "STOP_UNCONFIRMED";
          runtimeIoUnconfirmed = true;
          requestStop(true);
        }
        reject(
          new ValidationInterrupted(
            activeMedia ? "MEDIA_STOP_UNCONFIRMED" : "RELATED_IO_UNCONFIRMED",
          ),
        );
      };
      onAbort = () => {
        try {
          const state = readMediaOperationState(context);
          if (state.phase !== "stopping") return;
          const remaining =
            state.stop.cleanupDeadlineMonotonicMs - performance.now();
          if (remaining <= 0) finish();
          else
            timer = setTimeout(
              onAbort,
              Math.min(remaining, CLEANUP_OBSERVATION_MS),
            );
        } catch {
          finish();
        }
      };
      context.signal.addEventListener("abort", onAbort, { once: true });
      if (context.signal.aborted) onAbort();
    });
    try {
      return await Promise.race([task, stopped]);
    } finally {
      if (timer) clearTimeout(timer);
      context.signal.removeEventListener("abort", onAbort);
    }
  };
  const settleIo = async (): Promise<void> => {
    while (pendingIo.size) {
      let state;
      try {
        state = readMediaOperationState(context);
      } catch {
        relatedIo = "unconfirmed";
        return;
      }
      const deadline =
        state.phase === "stopping"
          ? state.stop.cleanupDeadlineMonotonicMs
          : state.deadlineMonotonicMs;
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        if (state.phase === "stopping") {
          relatedIo = "unconfirmed";
          return;
        }
        // Observe the factory's scheduled deadline; never create another 5s budget.
        readMediaOperationState(context);
        continue;
      }
      let timer: NodeJS.Timeout | undefined;
      let abort: (() => void) | undefined;
      const changed = new Promise<void>((resolve) => {
        timer = setTimeout(
          resolve,
          state.phase === "stopping"
            ? Math.min(remaining, CLEANUP_OBSERVATION_MS)
            : remaining,
        );
        if (state.phase === "active") {
          abort = resolve;
          state.signal.addEventListener("abort", abort, { once: true });
          if (state.signal.aborted) resolve();
        }
      });
      try {
        await Promise.race([Promise.allSettled([...pendingIo]), changed]);
      } finally {
        if (timer) clearTimeout(timer);
        if (abort) state.signal.removeEventListener("abort", abort);
      }
    }
  };
  const completion = (
    media: readonly MediaFact[] = [],
  ): ValidationCompletion => {
    const mediaStopped =
      runtimeFailure === "STOP_UNCONFIRMED" ||
      media.some((fact) => fact.result.stopped === "unknown")
        ? "unknown"
        : media.some((fact) => fact.result.stopped === "confirmed")
          ? "confirmed"
          : "not-started";
    return {
      mediaStopped,
      relatedIo:
        runtimeIoUnconfirmed || mediaStopped === "unknown"
          ? "unconfirmed"
          : relatedIo,
      maintenanceRequired:
        mediaStopped === "unknown" ||
        relatedIo === "unconfirmed" ||
        runtimeIoUnconfirmed,
    };
  };
  return {
    context,
    checkpoint,
    requestStop,
    trackIo,
    awaitOperationTask,
    settleIo,
    completion,
    get runtimeFailure() {
      return runtimeFailure;
    },
    set runtimeFailure(value: LaunchFailureCode | null) {
      if (runtimeFailure !== "STOP_UNCONFIRMED") runtimeFailure = value;
    },
    get activeMedia() {
      return activeMedia;
    },
    set activeMedia(value: boolean) {
      activeMedia = value;
    },
    get runtimeIoUnconfirmed() {
      return runtimeIoUnconfirmed;
    },
    set runtimeIoUnconfirmed(value: boolean) {
      runtimeIoUnconfirmed ||= value;
    },
  };
}
export type ValidationOperationScope = ReturnType<
  typeof createValidationOperationScope
>;
