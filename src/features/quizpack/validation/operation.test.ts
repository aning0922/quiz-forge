import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { P2aDatabase } from "@/lib/db/client";
import { ArchiveOperation } from "./operation";
import {
  createMediaOperationContext,
  disposeMediaOperationContext,
  readMediaOperationState,
  requestMediaOperationStop,
  type MediaOperationContext,
} from "../server/media";
let now: number;
const contexts: MediaOperationContext[] = [];
beforeEach(() => {
  now = 100;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => {
  for (const context of contexts.splice(0))
    disposeMediaOperationContext(context);
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function fixture() {
  const abort = new AbortController(),
    context = createMediaOperationContext({
      signal: abort.signal,
      deadlineMonotonicMs: 60100,
    });
  contexts.push(context);
  const end = vi.fn(async () => {}),
    db = { sql: { end } } as unknown as P2aDatabase;
  return { context, abort, end, op: new ArchiveOperation(db, context) };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
it("preclaim proof requires closed gate and all IO settled", async () => {
  const { op } = fixture(),
    io = deferred<void>();
  const task = op.fileTask(() => io.promise);
  await Promise.resolve();
  expect(op.canIssuePreclaimNotStarted()).toBe(false);
  op.stop();
  expect(op.canIssuePreclaimNotStarted()).toBe(false);
  io.resolve();
  await task;
  await op.settle();
  expect(op.canIssuePreclaimNotStarted()).toBe(true);
  await expect(op.fileTask(async () => {})).rejects.toMatchObject({
    code: "STUDIO_UNAVAILABLE",
  });
});
it("entering possible claim permanently bars not-started even when a later error is known", async () => {
  const { op } = fixture();
  op.enterClaimBoundary();
  op.stop();
  await op.settle();
  expect(op.canIssuePreclaimNotStarted()).toBe(false);
  expect(op.canIssueStoppedReceipt()).toBe(false);
  op.confirmClaim();
  expect(op.canIssueStoppedReceipt()).toBe(true);
});
it("candidate calls require strict completion before any stopped receipt", async () => {
  const { op } = fixture();
  op.enterClaimBoundary();
  op.confirmClaim();
  op.enterCandidateBoundary();
  op.stop();
  await op.settle();
  expect(op.completion().mediaStopped).toBe("unknown");
  expect(op.canIssueStoppedReceipt()).toBe(false);
  op.recordPlatformCompletion({
    mediaStopped: "confirmed",
    relatedIo: "settled",
    maintenanceRequired: false,
  });
  expect(op.canIssueStoppedReceipt()).toBe(true);
});
it("a late close after first cleanup deadline remains unknown even in the same callback", async () => {
  const { op, context } = fixture(),
    io = deferred<void>();
  const task = op.fileTask(() => io.promise);
  await Promise.resolve();
  op.stop();
  const state = readMediaOperationState(context);
  expect(state.phase).toBe("stopping");
  now = 5101;
  io.resolve();
  await task;
  await op.settle();
  expect(op.completion().relatedIo).toBe("unconfirmed");
  expect(op.canIssuePreclaimNotStarted()).toBe(false);
});
it("cleanup tightening uses the original shared deadline and late settlement cannot renew it", async () => {
  const { op, context } = fixture(),
    io = deferred<void>();
  const task = op.fileTask(() => io.promise),
    failed = expect(task).rejects.toMatchObject({
      code: "VALIDATION_RECOVERY_REQUIRED",
    });
  await Promise.resolve();
  op.stop();
  requestMediaOperationStop(context, "CANCELLED", 1200);
  now = 1200;
  await vi.advanceTimersByTimeAsync(10);
  await failed;
  io.resolve();
  await Promise.resolve();
  await op.settle();
  expect(op.completion().relatedIo).toBe("unconfirmed");
});
it("cancel before deferred work closes the gate without starting new file IO", async () => {
  const { op, abort } = fixture(),
    work = vi.fn(async () => {});
  const task = op.fileTask(work);
  abort.abort();
  await expect(task).rejects.toMatchObject({ code: "VALIDATION_CANCELLED" });
  expect(work).not.toHaveBeenCalled();
  op.stop();
  await op.settle();
  expect(op.canIssuePreclaimNotStarted()).toBe(true);
});
it("unknown platform IO and UNKNOWN are sticky across later settled results", async () => {
  const { op } = fixture();
  op.recordPlatformCompletion({
    mediaStopped: "unknown",
    relatedIo: "unconfirmed",
    maintenanceRequired: true,
  });
  op.recordPlatformCompletion({
    mediaStopped: "confirmed",
    relatedIo: "settled",
    maintenanceRequired: false,
  });
  await op.settle();
  expect(op.completion()).toEqual({
    mediaStopped: "unknown",
    relatedIo: "unconfirmed",
    maintenanceRequired: true,
  });
  expect(op.canIssuePreclaimNotStarted()).toBe(false);
});
it("database cancellation invalidates the owned client and an unsettled query bars preclaim proof", async () => {
  const { op, abort, end } = fixture(),
    query = deferred<string>(),
    work = vi.fn(() => query.promise);
  const task = op.databaseAwait("write", work);
  await Promise.resolve();
  abort.abort();
  await expect(task).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
  op.stop();
  expect(op.canIssuePreclaimNotStarted()).toBe(false);
  await Promise.resolve();
  expect(end).toHaveBeenCalledTimes(1);
  now = 5101;
  query.resolve("committed");
  await Promise.resolve();
  await op.settle();
  expect(op.canIssuePreclaimNotStarted()).toBe(false);
  await expect(op.databaseAwait("read", work)).rejects.toBeDefined();
  expect(work).toHaveBeenCalledTimes(1);
});
it("a confirmed DB result is retained without an invented replacement connection", async () => {
  const { op, end } = fixture();
  expect(await op.databaseAwait("write", async () => "committed")).toBe(
    "committed",
  );
  expect(end).not.toHaveBeenCalled();
  expect(op.completion().relatedIo).toBe("settled");
});

it("candidate cannot enter until claim COMMIT has been confirmed", () => {
  const { op } = fixture();
  expect(() => op.enterCandidateBoundary()).toThrow(
    "VALIDATION_RECOVERY_REQUIRED",
  );
  op.enterClaimBoundary();
  expect(() => op.enterCandidateBoundary()).toThrow(
    "VALIDATION_RECOVERY_REQUIRED",
  );
  op.confirmClaim();
  expect(() => op.enterCandidateBoundary()).not.toThrow();
});
it("a synchronous abort listener upgrading shared UNKNOWN vetoes every receipt", async () => {
  const { op, context } = fixture();
  op.enterClaimBoundary();
  op.confirmClaim();
  context.signal.addEventListener(
    "abort",
    () => requestMediaOperationStop(context, "STOP_UNCONFIRMED"),
    { once: true },
  );
  op.stop("CANCELLED");
  await op.settle();
  expect(op.completion()).toEqual({
    mediaStopped: "unknown",
    relatedIo: "unconfirmed",
    maintenanceRequired: true,
  });
  expect(op.canIssueStoppedReceipt()).toBe(false);
  const write = vi.fn(async () => {});
  await expect(op.stoppedReceiptTask(write)).rejects.toMatchObject({
    code: "VALIDATION_RECOVERY_REQUIRED",
  });
  expect(write).not.toHaveBeenCalled();
});

it("queued receipt rechecks shared UNKNOWN immediately before executing", async () => {
  const { op, context } = fixture();
  op.enterClaimBoundary();
  op.confirmClaim();
  op.stop("CANCELLED");
  await op.settle();
  const work = vi.fn(async () => "published"),
    task = op.stoppedReceiptTask(work);
  requestMediaOperationStop(context, "STOP_UNCONFIRMED");
  await expect(task).rejects.toMatchObject({
    code: "VALIDATION_RECOVERY_REQUIRED",
  });
  expect(work).not.toHaveBeenCalled();
  expect(op.completion()).toEqual({
    mediaStopped: "unknown",
    relatedIo: "unconfirmed",
    maintenanceRequired: true,
  });
});
it("the exact receipt task does not count itself as unsettled prerequisite IO", async () => {
  const { op } = fixture();
  op.enterClaimBoundary();
  op.confirmClaim();
  op.stop("CANCELLED");
  await op.settle();
  const work = vi.fn(async () => "published");
  expect(await op.stoppedReceiptTask(work)).toBe("published");
  expect(work).toHaveBeenCalledTimes(1);
  expect(op.completion().relatedIo).toBe("settled");
});

it("receipt-owned continuation rechecks UNKNOWN after awaited IO before further writes", async () => {
  const { op, context } = fixture();
  op.enterClaimBoundary();
  op.confirmClaim();
  op.stop("CANCELLED");
  await op.settle();
  const io = deferred<void>(),
    write = vi.fn();
  const task = op.stoppedReceiptTask(async (check) => {
    await io.promise;
    check();
    write();
  });
  await Promise.resolve();
  requestMediaOperationStop(context, "STOP_UNCONFIRMED");
  io.resolve();
  await expect(task).rejects.toMatchObject({
    code: "VALIDATION_RECOVERY_REQUIRED",
  });
  expect(write).not.toHaveBeenCalled();
});

it("normal receipt gates preserve the business deadline and permit one DB finalization only", async () => {
  const { op, context } = fixture();
  op.enterClaimBoundary();
  op.confirmClaim();
  op.enterCandidateBoundary();
  op.recordPlatformCompletion({
    mediaStopped: "confirmed",
    relatedIo: "settled",
    maintenanceRequired: false,
  });
  op.closeNonDbGate();
  await op.settle();
  expect(readMediaOperationState(context).phase).toBe("active");
  expect(context.deadlineMonotonicMs).toBe(60100);
  await expect(op.fileTask(async () => {})).rejects.toMatchObject({
    code: "VALIDATION_RECOVERY_REQUIRED",
  });
  expect(
    await op.stoppedReceiptTask(async (check) => {
      check();
      return "receipt";
    }),
  ).toBe("receipt");
  expect(readMediaOperationState(context).phase).toBe("active");
  const complete = vi.fn(async () => "ready");
  expect(await op.finalizeDatabaseOnce(complete)).toBe("ready");
  await expect(op.finalizeDatabaseOnce(complete)).rejects.toMatchObject({
    code: "VALIDATION_RECOVERY_REQUIRED",
  });
  await expect(op.stoppedReceiptTask(async () => {})).rejects.toMatchObject({
    code: "VALIDATION_RECOVERY_REQUIRED",
  });
  expect(complete).toHaveBeenCalledTimes(1);
});
it("pending finalization remains request IO and does not inherit the file receipt's settled scope", async () => {
  const { op } = fixture(),
    commit = deferred<void>();
  op.enterClaimBoundary();
  op.confirmClaim();
  op.closeNonDbGate();
  await op.settle();
  await op.stoppedReceiptTask(async () => {});
  const task = op.finalizeDatabaseOnce(() => commit.promise);
  await Promise.resolve();
  expect(op.completion().relatedIo).toBe("unconfirmed");
  commit.resolve();
  await task;
  expect(op.completion().relatedIo).toBe("settled");
});
it("cancelled normal receipt cannot authorize complete under a cleanup extension", async () => {
  const { op, abort } = fixture();
  op.enterClaimBoundary();
  op.confirmClaim();
  op.closeNonDbGate();
  await op.settle();
  await op.stoppedReceiptTask(async () => {});
  abort.abort();
  const complete = vi.fn(async () => {});
  await expect(op.finalizeDatabaseOnce(complete)).rejects.toMatchObject({
    code: "VALIDATION_CANCELLED",
  });
  expect(complete).not.toHaveBeenCalled();
});
it("failure of finalization permanently bars any later write or receipt", async () => {
  const { op } = fixture();
  op.enterClaimBoundary();
  op.confirmClaim();
  op.closeNonDbGate();
  await op.settle();
  await op.stoppedReceiptTask(async () => {});
  const complete = vi.fn(async () => {
    throw new Error("SYNTHETIC_COMMIT_FAILURE");
  });
  await expect(op.finalizeDatabaseOnce(complete)).rejects.toThrow(
    "SYNTHETIC_COMMIT_FAILURE",
  );
  await expect(op.databaseAwait("write", complete)).rejects.toMatchObject({
    code: "VALIDATION_RECOVERY_REQUIRED",
  });
  await expect(op.stoppedReceiptTask(async () => {})).rejects.toMatchObject({
    code: "VALIDATION_RECOVERY_REQUIRED",
  });
  expect(complete).toHaveBeenCalledTimes(1);
});

it("ordinary write is blocked after files close and after receipt publication", async () => {
  const { op } = fixture();
  op.enterClaimBoundary();
  op.confirmClaim();
  op.closeNonDbGate();
  await op.settle();
  const work = vi.fn(async () => "unexpected write");
  await expect(op.databaseAwait("write", work)).rejects.toMatchObject({
    code: "VALIDATION_RECOVERY_REQUIRED",
  });
  await op.stoppedReceiptTask(async () => {});
  await expect(op.databaseAwait("write", work)).rejects.toMatchObject({
    code: "VALIDATION_RECOVERY_REQUIRED",
  });
  expect(work).not.toHaveBeenCalled();
});
it("queued finalization rechecks related IO immediately before work and consumes the gate forever", async () => {
  const { op } = fixture();
  op.enterClaimBoundary();
  op.confirmClaim();
  op.closeNonDbGate();
  await op.settle();
  await op.stoppedReceiptTask(async () => {});
  const work = vi.fn(async () => "unexpected complete"),
    task = op.finalizeDatabaseOnce(work);
  op.markRelatedIoUnknown();
  await expect(task).rejects.toMatchObject({
    code: "VALIDATION_RECOVERY_REQUIRED",
  });
  await expect(op.finalizeDatabaseOnce(work)).rejects.toMatchObject({
    code: "VALIDATION_RECOVERY_REQUIRED",
  });
  expect(work).not.toHaveBeenCalled();
});

it("an ordinary write queued before file closure cannot start after the gate closes", async () => {
  const { op } = fixture(),
    work = vi.fn(async () => "unexpected SQL");
  const task = op.databaseAwait("write", work);
  op.closeNonDbGate();
  await expect(task).rejects.toMatchObject({
    code: "VALIDATION_RECOVERY_REQUIRED",
  });
  expect(work).not.toHaveBeenCalled();
});
