import "server-only";
import { StudioError } from "@/lib/http-security/errors";
import type { P2aDatabase, DatabaseBudget } from "@/lib/db/client";
import {
  createMediaOperationContext,
  disposeMediaOperationContext,
  readMediaOperationState,
  requestMediaOperationStop,
  type MediaOperationContext,
  type MediaStopReason,
} from "../server/media";
import type { ValidationCompletion } from "../server/validation/operation-scope";
import type { StorageLock } from "../import/storage-lock";
import { VALIDATION_TIMEOUT_MS } from "./limits";

export function createValidationContext(
  signal: AbortSignal,
  startedAt = performance.now(),
) {
  const context = createMediaOperationContext({
    signal,
    deadlineMonotonicMs: startedAt + VALIDATION_TIMEOUT_MS,
  });
  return { context, dispose: () => disposeMediaOperationContext(context) };
}
export type FileStopAckQualification = Readonly<{
  readonly kind: "file-stop-ack";
}>;
const ackQualifications = new WeakMap<
  FileStopAckQualification,
  ArchiveOperation
>();
const invalidDatabases = new WeakSet<P2aDatabase>();
/** Owns only this request's business gate, DB budget and main-process IO. Platform proof comes from A. */
export class ArchiveOperation {
  readonly databaseBudget: DatabaseBudget;
  private readonly pending = new Set<Promise<unknown>>();
  private relatedIoUnknown = false;
  private platformUnknown = false;
  private platformStopped: "not-started" | "confirmed" = "not-started";
  private businessClosed = false;
  private nonDbClosed = false;
  private receiptState: "available" | "running" | "done" | "failed" =
    "available";
  private ackState: "available" | "running" | "confirmed" | "failed" =
    "available";
  private qualification: FileStopAckQualification | undefined;
  private finalizationEntered = false;
  private claimEntered = false;
  private claimConfirmed = false;
  private candidateEntered = false;
  private activePlatformTasks = 0;
  private candidateProof = false;
  private platformRelatedIoUnknown = false;
  private candidateClosed = false;
  private lock: StorageLock | undefined;
  private lockClosing: Promise<void> | undefined;
  private removeLockListener: (() => void) | undefined;
  constructor(
    readonly db: P2aDatabase,
    readonly context: MediaOperationContext,
  ) {
    readMediaOperationState(context);
    this.databaseBudget = Object.freeze({
      signal: context.signal,
      deadlineMonotonicMs: context.deadlineMonotonicMs,
    });
  }
  attachLock(lock: StorageLock) {
    if (this.lock) throw new StudioError("VALIDATION_LOCK_LOST");
    this.lock = lock;
    const lost = () => {
      this.stop("STORAGE_LOCK_LOST");
    };
    lock.controller.signal.addEventListener("abort", lost, { once: true });
    this.removeLockListener = () =>
      lock.controller.signal.removeEventListener("abort", lost);
    if (lock.controller.signal.aborted) lost();
    this.checkpoint();
  }
  detachLock() {
    this.removeLockListener?.();
    this.removeLockListener = undefined;
  }
  closeStorageLock(): Promise<void> {
    if (this.lockClosing) return this.lockClosing;
    // Revoke every continuation before close can synchronously broadcast cancellation.
    this.stop("STOP_REQUESTED");
    this.detachLock();
    const lock = this.lock;
    this.lock = undefined;
    this.lockClosing = lock
      ? this.boundedTask(
          Promise.resolve()
            .then(() => lock.close())
            .then((closed) => {
              if (!closed) this.relatedIoUnknown = true;
            }),
        )
      : Promise.resolve();
    return this.lockClosing;
  }
  checkpoint() {
    const state = readMediaOperationState(this.context);
    if (state.phase === "stopping") {
      this.businessClosed = true;
      if (state.stop.reason === "STOP_UNCONFIRMED") this.platformUnknown = true;
      throw new StudioError(
        state.stop.reason === "STORAGE_LOCK_LOST"
          ? "VALIDATION_LOCK_LOST"
          : state.stop.reason === "CANCELLED"
            ? "VALIDATION_CANCELLED"
            : state.stop.reason === "BUSINESS_DEADLINE_EXCEEDED" ||
                state.stop.reason === "IMAGE_DEADLINE_EXCEEDED"
              ? "VALIDATION_TIMEOUT"
              : state.stop.reason === "STOP_UNCONFIRMED"
                ? "VALIDATION_RECOVERY_REQUIRED"
                : "STUDIO_UNAVAILABLE",
      );
    }
    if (this.businessClosed)
      throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
    try {
      this.lock?.assert();
    } catch {
      this.stop("STORAGE_LOCK_LOST");
      throw new StudioError("VALIDATION_LOCK_LOST");
    }
  }
  stop(reason: MediaStopReason = "RUNTIME_FAILED") {
    // Close every continuation's business/candidate gate before synchronous abort broadcast.
    this.businessClosed = true;
    this.nonDbClosed = true;
    this.candidateClosed = true;
    requestMediaOperationStop(this.context, reason);
    if (reason === "STOP_UNCONFIRMED") this.platformUnknown = true;
  }
  nonDbCheckpoint() {
    this.checkpoint();
    if (this.nonDbClosed) throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
  }
  closeNonDbGate() {
    this.nonDbClosed = true;
    this.candidateClosed = true;
    if (
      this.activePlatformTasks ||
      (this.candidateEntered && !this.candidateProof)
    ) {
      this.stop("STOP_REQUESTED");
      throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
    }
  }
  async platformTask<T>(work: () => Promise<T>): Promise<T> {
    this.nonDbCheckpoint();
    this.activePlatformTasks++;
    try {
      return await this.fileTask(work);
    } finally {
      this.activePlatformTasks--;
    }
  }
  enterClaimBoundary() {
    this.nonDbCheckpoint();
    this.claimEntered = true;
  }
  confirmClaim() {
    if (!this.claimEntered)
      throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
    this.claimConfirmed = true;
  }
  claimedIoCheckpoint() {
    this.nonDbCheckpoint();
    if (!this.claimConfirmed)
      throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
  }
  enterCandidateBoundary() {
    this.nonDbCheckpoint();
    if (!this.claimConfirmed || this.candidateClosed || this.candidateEntered)
      throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
    this.candidateEntered = true;
  }
  recordPlatformCompletion(completion: ValidationCompletion) {
    if (this.candidateEntered) this.candidateProof = true;
    if (
      completion.relatedIo === "unconfirmed" ||
      completion.maintenanceRequired
    )
      this.platformRelatedIoUnknown = true;
    if (completion.mediaStopped === "unknown") {
      this.platformUnknown = true;
      this.stop("STOP_UNCONFIRMED");
    } else {
      if (completion.mediaStopped === "confirmed")
        this.platformStopped = "confirmed";
      if (
        completion.maintenanceRequired ||
        completion.relatedIo === "unconfirmed"
      )
        this.stop("RUNTIME_FAILED");
    }
  }
  markRelatedIoUnknown() {
    this.relatedIoUnknown = true;
  }
  private observeExpiry() {
    const state = readMediaOperationState(this.context);
    if (
      state.phase === "stopping" &&
      performance.now() >= state.stop.cleanupDeadlineMonotonicMs &&
      this.pending.size
    )
      this.relatedIoUnknown = true;
    return state;
  }
  private track<T>(task: Promise<T>): Promise<T> {
    this.pending.add(task);
    const settled = () => {
      // Sample before deleting. A same-callback late close cannot erase missed proof.
      try {
        this.observeExpiry();
      } catch {
        this.relatedIoUnknown = true;
      }
      this.pending.delete(task);
    };
    void task.then(settled, settled);
    return task;
  }
  private async boundedTask<T>(task: Promise<T>): Promise<T> {
    this.track(task);
    let timer: NodeJS.Timeout | undefined;
    let finished = false;
    let onAbort: () => void = () => {};
    const expired = new Promise<never>((_, reject) => {
      const observe = () => {
        if (finished) return;
        if (timer) clearTimeout(timer);
        let state;
        try {
          state = this.observeExpiry();
        } catch {
          finished = true;
          this.relatedIoUnknown = true;
          reject(new StudioError("VALIDATION_RECOVERY_REQUIRED"));
          return;
        }
        // Reading an expired context can synchronously deliver this same abort observer.
        if (timer) clearTimeout(timer);
        if (state.phase === "stopping") {
          const left =
            state.stop.cleanupDeadlineMonotonicMs - performance.now();
          if (left <= 0) {
            finished = true;
            this.relatedIoUnknown = true;
            reject(new StudioError("VALIDATION_RECOVERY_REQUIRED"));
          } else
            timer = setTimeout(
              observe,
              Math.max(1, Math.min(10, Math.ceil(left))),
            );
        } else
          timer = setTimeout(
            observe,
            Math.max(
              1,
              Math.ceil(state.deadlineMonotonicMs - performance.now()),
            ),
          );
      };
      onAbort = observe;
      this.context.signal.addEventListener("abort", onAbort, { once: true });
      observe();
    });
    try {
      return await Promise.race([task, expired]);
    } finally {
      finished = true;
      if (timer) clearTimeout(timer);
      this.context.signal.removeEventListener("abort", onAbort);
    }
  }
  async fileTask<T>(work: () => Promise<T>): Promise<T> {
    this.nonDbCheckpoint();
    const task = Promise.resolve().then(() => {
      this.nonDbCheckpoint();
      return work();
    });
    return this.boundedTask(task);
  }
  /** Close/receipt work is allowed only under the already established first-stop deadline. */
  cleanupCheckpoint() {
    const state = this.observeExpiry();
    const deadline =
      state.phase === "stopping"
        ? state.stop.cleanupDeadlineMonotonicMs
        : state.deadlineMonotonicMs;
    if (performance.now() >= deadline)
      throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
  }
  async stoppedReceiptTask<T>(
    work: (check: () => void) => Promise<T>,
  ): Promise<T> {
    if (!this.canIssueStoppedReceipt())
      throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
    this.cleanupCheckpoint();
    this.receiptState = "running";
    const task: Promise<T> = Promise.resolve().then(() => {
      // Recheck at execution, excluding only this exact queued receipt task.
      if (!this.receiptQualified(task))
        throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
      const check = () => {
        if (!this.receiptQualified(task))
          throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
        this.cleanupCheckpoint();
      };
      check();
      return work(check);
    });
    try {
      const result = await this.boundedTask(task);
      this.receiptState = "done";
      return result;
    } catch (error) {
      this.receiptState = "failed";
      throw error;
    }
  }
  /** Private authority exists only after this publisher's final close; it cannot survive serialization. */
  fileStopAckQualification(): FileStopAckQualification {
    this.checkpoint();
    if (this.qualification || !this.ackQualified())
      throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
    const qualification = Object.freeze({
      kind: "file-stop-ack" as const,
      toJSON() {
        throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
      },
    });
    ackQualifications.set(qualification, this);
    this.qualification = qualification;
    return qualification;
  }
  async acknowledgeDatabaseOnce<T>(
    qualification: FileStopAckQualification,
    work: () => PromiseLike<T>,
  ): Promise<T> {
    this.checkpoint();
    if (
      ackQualifications.get(qualification) !== this ||
      this.qualification !== qualification ||
      !this.ackQualified()
    )
      throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
    this.ackState = "running";
    try {
      const result = await this.awaitDatabase("write", work, (task) => {
        if (!this.ackQualified(task))
          throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
      });
      this.checkpoint();
      if (!this.ackQualifiedForConfirmation())
        throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
      this.ackState = "confirmed";
      return result;
    } catch (error) {
      this.ackState = "failed";
      throw error;
    }
  }
  private ackQualified(excludedTask?: Promise<unknown>) {
    return (
      (excludedTask
        ? this.ackState === "running"
        : this.ackState === "available") &&
      this.ackQualifiedForConfirmation(excludedTask)
    );
  }
  private ackQualifiedForConfirmation(excludedTask?: Promise<unknown>) {
    return (
      Boolean(this.lock) &&
      this.claimConfirmed &&
      this.nonDbClosed &&
      this.receiptState === "done" &&
      !this.finalizationEntered &&
      !this.completionFor(excludedTask).maintenanceRequired
    );
  }
  hasEnteredAcknowledgement() {
    return this.ackState !== "available";
  }
  async finalizeDatabaseOnce<T>(work: () => PromiseLike<T>): Promise<T> {
    this.checkpoint();
    if (!this.finalizationQualified())
      throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
    this.finalizationEntered = true;
    return this.awaitDatabase("write", work, (task) => {
      if (!this.finalizationQualified(task))
        throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
    });
  }
  private finalizationQualified(excludedTask?: Promise<unknown>) {
    return (
      (excludedTask ? this.finalizationEntered : !this.finalizationEntered) &&
      Boolean(this.lock) &&
      this.nonDbClosed &&
      this.receiptState === "done" &&
      this.ackState === "confirmed" &&
      !this.completionFor(excludedTask).maintenanceRequired
    );
  }
  hasEnteredFinalization() {
    return this.finalizationEntered;
  }
  async databaseAwait<T>(
    kind: "read" | "write",
    work: () => PromiseLike<T>,
  ): Promise<T> {
    if (kind === "write" && (this.nonDbClosed || this.finalizationEntered))
      throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
    return this.awaitDatabase(
      kind,
      work,
      kind === "write"
        ? () => {
            if (this.nonDbClosed || this.finalizationEntered)
              throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
          }
        : undefined,
    );
  }
  private async awaitDatabase<T>(
    kind: "read" | "write",
    work: () => PromiseLike<T>,
    beforeWork?: (task: Promise<unknown>) => void,
  ): Promise<T> {
    this.checkpoint();
    if (invalidDatabases.has(this.db))
      throw new StudioError(
        kind === "write" ? "WRITE_OUTCOME_UNKNOWN" : "VALIDATION_TIMEOUT",
      );
    let rejectStop: (error: StudioError) => void = () => {};
    const stopped = new Promise<never>((_, reject) => {
      rejectStop = reject;
    });
    const abort = () => {
      if (!invalidDatabases.has(this.db)) {
        invalidDatabases.add(this.db);
        this.track(
          Promise.resolve()
            .then(() => this.db.sql.end({ timeout: 0 }))
            .catch(() => {
              this.relatedIoUnknown = true;
            }),
        );
      }
      rejectStop(
        new StudioError(
          kind === "write" ? "WRITE_OUTCOME_UNKNOWN" : "VALIDATION_TIMEOUT",
        ),
      );
    };
    this.context.signal.addEventListener("abort", abort, { once: true });
    const task: Promise<T> = this.track(
      Promise.resolve().then(() => {
        this.checkpoint();
        beforeWork?.(task);
        return work();
      }),
    );
    if (this.context.signal.aborted) abort();
    try {
      return await Promise.race([task, stopped]);
    } finally {
      this.context.signal.removeEventListener("abort", abort);
    }
  }
  async settle() {
    while (this.pending.size) {
      try {
        await this.boundedTask(Promise.allSettled([...this.pending]));
      } catch {
        this.relatedIoUnknown = true;
        return;
      }
    }
    this.observeExpiry();
  }
  private completionFor(excludedTask?: Promise<unknown>): ValidationCompletion {
    this.observeExpiry();
    const state = readMediaOperationState(this.context);
    if (state.phase === "stopping" && state.stop.reason === "STOP_UNCONFIRMED")
      this.platformUnknown = true;
    const mediaUnknown =
      this.platformUnknown || (this.candidateEntered && !this.candidateProof);
    const ioUnknown =
      mediaUnknown ||
      this.relatedIoUnknown ||
      this.platformRelatedIoUnknown ||
      this.pending.size >
        (excludedTask && this.pending.has(excludedTask) ? 1 : 0);
    return {
      mediaStopped: mediaUnknown ? "unknown" : this.platformStopped,
      relatedIo: ioUnknown ? "unconfirmed" : "settled",
      maintenanceRequired: mediaUnknown || ioUnknown,
    };
  }
  completion(): ValidationCompletion {
    return this.completionFor();
  }
  /** An error code cannot confer this authority. The claim gate is permanently closed first. */
  canIssuePreclaimNotStarted(): boolean {
    return (
      this.businessClosed &&
      !this.claimEntered &&
      !this.candidateEntered &&
      !this.completion().maintenanceRequired
    );
  }
  private receiptQualified(excludedTask?: Promise<unknown>): boolean {
    return (
      this.claimConfirmed &&
      this.nonDbClosed &&
      this.candidateClosed &&
      !this.finalizationEntered &&
      (excludedTask
        ? this.receiptState === "running"
        : this.receiptState === "available") &&
      !this.completionFor(excludedTask).maintenanceRequired
    );
  }
  canIssueStoppedReceipt(): boolean {
    return this.receiptQualified();
  }
}
