import assert from "node:assert/strict";
import { afterEach, expect, it, vi } from "vitest";
import * as clients from "../../src/lib/db/client";
import { StorageReadGuard } from "../../src/features/quizpack/resource-read/guard";
import { ResourceReadTask } from "../../src/features/quizpack/resource-read/task";
import { createConsumerFlowService } from "../../src/features/fulfillment/consumer-flow/service";
import {
  gate,
  openPolicyFaultFixture,
} from "../support/consumer-policy-fault-fixture";

afterEach(() => vi.restoreAllMocks());

/** Same post-native-COMMIT result-loss technique as p4-consumer-faults, preserving
 * the exact observer-issued client. Real backend termination is a separate case. */
function observeFaults() {
  const factory = clients.createObservedDatabase;
  const state = {
    opens: 0,
    closes: 0,
    lostResults: 0,
    loseNextResult: false,
    nativeInvalidations: 0,
    pids: [] as number[],
  };
  const guard = vi.spyOn(StorageReadGuard, "acquire"),
    task = vi.spyOn(ResourceReadTask, "acquire");
  vi.spyOn(clients, "createObservedDatabase").mockImplementation(
    async (...args) => {
      const actual = await factory(...args),
        nativeBegin = actual.sql.begin;
      state.opens++;
      const [backend] = await actual.sql<
        { pid: number }[]
      >`SELECT pg_backend_pid() pid`;
      assert(backend);
      state.pids.push(backend.pid);
      actual.sql.begin = (async (...parameters: unknown[]) => {
        let result: unknown;
        try {
          result = await Reflect.apply(nativeBegin, actual.sql, parameters);
        } catch (e) {
          if (
            (e as { quizforgeConnectionInvalidated?: boolean })
              .quizforgeConnectionInvalidated === true
          )
            state.nativeInvalidations++;
          throw e;
        }
        if (
          parameters[0] === "isolation level read committed" &&
          state.loseNextResult
        ) {
          state.loseNextResult = false;
          state.lostResults++;
          throw Object.assign(
            Error("POLICY_INJECTED_POST_COMMIT_RESULT_LOSS"),
            { code: "CONNECTION_CLOSED" },
          );
        }
        return result;
      }) as typeof nativeBegin;
      return {
        ...actual,
        close: async () => {
          await actual.close();
          state.closes++;
        },
      };
    },
  );
  return { state, guard, task };
}

async function waitForOriginalHold(
  ready: ReturnType<typeof gate>,
  writer: Promise<unknown>,
) {
  const early = await Promise.race([ready.promise.then(() => null), writer]);
  if (early !== null) {
    if (early && typeof early === "object" && "error" in early)
      throw early.error;
    throw Error("ORIGINAL_COMPLETION_FINISHED_BEFORE_HOLD");
  }
}

it("holds unresolved recovery behind a late completion; recovers the original receipt after native COMMIT result loss and later enable", async () => {
  const f = await openPolicyFaultFixture(),
    ready = gate(),
    release = gate();
  let writer: Promise<unknown> | undefined;
  try {
    const c = await f.prepare("late-commit"),
      faults = observeFaults();
    const grantsBefore = JSON.stringify(await c.grantRows());
    // Observe the rejection immediately, before releasing the original callback.
    writer = c
      .finalCompletion(async () => {
        ready.resolve();
        await release.promise;
      })
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    await waitForOriginalHold(ready, writer);
    expect(await c.reportRows()).toHaveLength(0);
    await expect(
      f.request((owner) =>
        createConsumerFlowService(owner).resolveComplete(
          c.credentials,
          c.binding.session.sessionId,
          c.binding,
        ),
      ),
    ).rejects.toMatchObject({ code: "BUSY" });
    await expect(c.advance()).rejects.toMatchObject({ code: "55P03" });
    expect(await c.reportRows()).toHaveLength(0);
    // The native database commits once; only delivery of that result is lost.
    faults.state.loseNextResult = true;
    release.resolve();
    expect(await writer).toMatchObject({ error: { code: "OUTCOME_UNKNOWN" } });
    expect(faults.state.lostResults).toBe(1);
    expect(await c.reportRows()).toHaveLength(1);
    await c.advance();
    const recovered = await f.request((owner) =>
      createConsumerFlowService(owner).resolveComplete(
        c.credentials,
        c.binding.session.sessionId,
        c.binding,
      ),
    );
    expect(recovered.kind).toBe("applied");
    assert("report" in recovered);
    expect(recovered.report.binding).toEqual(c.binding);
    expect(recovered.report.reportId).toBe(c.snapshot.view.reportId);
    expect(JSON.stringify(await c.grantRows())).toBe(grantsBefore);
    expect(await c.reportRows()).toHaveLength(1);
    expect(faults.state.closes).toBe(faults.state.opens);
    for (const pid of faults.state.pids) await f.backendGone(pid);
    expect(faults.guard).not.toHaveBeenCalled();
    expect(faults.task).not.toHaveBeenCalled();
    await f.write(".late-commit.result.json", {
      status: "PASS_LATE_COMPLETION_COMMIT_RESULT_LOSS",
      originalBinding: c.binding,
      originalReportId: c.snapshot.view.reportId,
      busyBeforeOriginalSettled: true,
      originalReceiptRecovered: true,
      grantRowsUnchanged: true,
      reportCount: 1,
      sql: {
        opened: faults.state.opens,
        confirmedPhaseCloses: faults.state.closes,
        backendPidsGone: faults.state.pids,
      },
      resourceIo: { acquired: false, stopProof: null },
    });
  } catch (error) {
    await f.write(".late-commit.failure.json", {
      status: "FAILED_PRESERVED_NO_REPLAY",
      code: (error as { code?: string }).code,
      message: (error as Error).message,
    });
    throw error;
  } finally {
    release.resolve();
    if (writer) await writer;
    await f.close();
    await f.write(".fixture-close.json", {
      fixtureAppPoolClosed: true,
      fixtureOwnerPoolClosed: true,
      resourceIoAcquired: false,
    });
  }
});

it("terminates the exact completion backend; keeps unknown resolution loss pending and prevents the late original callback from committing after a version terminal", async () => {
  const f = await openPolicyFaultFixture(),
    ready = gate(),
    release = gate(),
    callbackDone = gate();
  let writer: Promise<unknown> | undefined,
    originalPid = 0,
    staleCode: string | undefined,
    staleInvalidated = false;
  try {
    const c = await f.prepare("disconnect"),
      faults = observeFaults();
    const grantsBefore = JSON.stringify(await c.grantRows());
    writer = c
      .finalCompletion(async (tx) => {
        try {
          const [backend] = await tx.sql<
            { pid: number }[]
          >`SELECT pg_backend_pid() pid`;
          assert(backend);
          originalPid = backend.pid;
          ready.resolve();
          await release.promise;
          try {
            await tx.sql`SELECT 1`;
          } catch (e) {
            staleCode = (e as { code?: string }).code;
            staleInvalidated =
              (e as { quizforgeConnectionInvalidated?: boolean })
                .quizforgeConnectionInvalidated === true;
          }
        } finally {
          callbackDone.resolve();
        }
      })
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    await waitForOriginalHold(ready, writer);
    assert(faults.state.pids.includes(originalPid));
    expect(await c.reportRows()).toHaveLength(0);
    const [terminated] =
      await f.app`SELECT pg_terminate_backend(${originalPid}) terminated`;
    expect(terminated!.terminated).toBe(true);
    await f.backendGone(originalPid);
    expect(await writer).toMatchObject({ error: { code: "OUTCOME_UNKNOWN" } });
    expect(faults.state.nativeInvalidations).toBeGreaterThanOrEqual(1);
    expect(await c.reportRows()).toHaveLength(0);
    // The original backend has exited, while its JS callback is deliberately still held.
    await c.advance();
    faults.state.loseNextResult = true;
    await expect(
      f.request((owner) =>
        createConsumerFlowService(owner).resolveComplete(
          c.credentials,
          c.binding.session.sessionId,
          c.binding,
        ),
      ),
    ).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(await c.reportRows()).toHaveLength(0);
    const terminal = await f.request((owner) =>
      createConsumerFlowService(owner).resolveComplete(
        c.credentials,
        c.binding.session.sessionId,
        c.binding,
      ),
    );
    expect(terminal.kind).toBe("version-superseded");
    expect(terminal.binding).toEqual(c.binding);
    expect("report" in terminal).toBe(false);
    release.resolve();
    await callbackDone.promise;
    expect(staleCode).toBe("CONNECTION_CLOSED");
    expect(staleInvalidated).toBe(true);
    expect(await c.reportRows()).toHaveLength(0);
    expect(JSON.stringify(await c.grantRows())).toBe(grantsBefore);
    expect(faults.state.closes).toBe(faults.state.opens);
    for (const pid of faults.state.pids) await f.backendGone(pid);
    expect(faults.guard).not.toHaveBeenCalled();
    expect(faults.task).not.toHaveBeenCalled();
    await f.write(".disconnect.result.json", {
      status: "PASS_BACKEND_DISCONNECT_AND_LATE_CALLBACK",
      originalBinding: c.binding,
      originalReportId: c.snapshot.view.reportId,
      originalBackendPid: originalPid,
      originalBackendGoneBeforeTerminal: true,
      resolveResultLossRemainedUnknown: true,
      terminalKind: terminal.kind,
      staleContinuation: { code: staleCode, invalidated: staleInvalidated },
      reportCount: 0,
      grantRowsUnchanged: true,
      sql: {
        opened: faults.state.opens,
        confirmedPhaseCloses: faults.state.closes,
        backendPidsGone: faults.state.pids,
      },
      resourceIo: { acquired: false, stopProof: null },
    });
  } catch (error) {
    await f.write(".disconnect.failure.json", {
      status: "FAILED_PRESERVED_NO_REPLAY",
      originalBackendPid: originalPid,
      code: (error as { code?: string }).code,
      message: (error as Error).message,
    });
    throw error;
  } finally {
    release.resolve();
    if (writer) await writer;
    if (originalPid) await callbackDone.promise;
    await f.close();
    await f.write(".fixture-close.json", {
      fixtureAppPoolClosed: true,
      fixtureOwnerPoolClosed: true,
      resourceIoAcquired: false,
    });
  }
});
