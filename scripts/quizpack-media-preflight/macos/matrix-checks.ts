// Closed offline matrix checks. Neither callback nor timing controls reach the public API.
import { readdirSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { CONTROL_ROOT, readControlForHarness } from "./control";
import { loadPolicy, RUNTIME_ROOTS, RUNTIME_TARGET } from "./policy";
import { runHarnessCase } from "./launcher";
import { parseWorkerOutput } from "../shared/output";
import { sealOfflineCandidate } from "../shared/provision";
import type { OfflineCandidateReceipt } from "../shared/runtime";
import { fixedMediaPlatformRoles } from "../../../src/features/quizpack/server/media/internal/runtime-location";
import { readMediaCapability } from "../../../src/features/quizpack/server/media/internal/capability";
import { readRuntimeMetadata } from "../../../src/features/quizpack/server/media/internal/runtime-files";

function requireTrue(value: unknown): asserts value {
  if (!value) throw new Error("SYNTHETIC_ASSERTION_FAILED");
}

/** The hanging apparent-success plan prevents a fast decode from escaping the in-flight barrier. */
export async function checkDelayedOwnedTimer() {
  requireTrue(readdirSync(CONTROL_ROOT).length === 0);
  const abort = new AbortController();
  const deadlineMonotonicMs = performance.now() + 5000;
  const expectedProfileId = loadPolicy("fault").profileId;
  let settled = false;
  const pending = runHarnessCase(
    { kind: "fault", scenario: "success-hang" },
    { signal: abort.signal, deadlineMonotonicMs },
  ).finally(() => {
    settled = true;
  });
  void pending.catch(() => undefined);
  try {
    const issued = readControlForHarness();
    requireTrue(
      issued.ownerPid === process.pid &&
        issued.profileId === expectedProfileId &&
        ["issued", "spawned"].includes(issued.phase),
    );
    let spawned = false;
    while (performance.now() < deadlineMonotonicMs && !settled) {
      const current = readControlForHarness();
      requireTrue(
        current.runId === issued.runId &&
          current.ownerPid === issued.ownerPid &&
          current.profileId === issued.profileId,
      );
      if (
        current.phase === "spawned" &&
        current.pid !== null &&
        current.workerStart !== null
      ) {
        spawned = true;
        break;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    requireTrue(spawned && !settled && performance.now() < deadlineMonotonicMs);
    // The absolute deadline began before policy initialization; this block never resets it.
    while (performance.now() < deadlineMonotonicMs + 200) {}
    const result = await pending;
    requireTrue(
      result.runId === issued.runId &&
        result.profileId === issued.profileId &&
        result.workerObserved &&
        result.code === "DEADLINE_EXCEEDED" &&
        result.stopped === "confirmed",
    );
    const apparentSuccess = parseWorkerOutput(result.output, {
      path: "assets/synthetic.png",
      mediaType: "image/png",
      sha256: "0".repeat(64),
      bytes: 1,
      width: 2,
      height: 2,
    });
    requireTrue(apparentSuccess.ok);
    requireTrue(readdirSync(CONTROL_ROOT).length === 0);
    return {
      ownedWorkerObserved: true,
      apparentSuccessRejected: true,
      stopped: "confirmed",
      code: "DEADLINE_EXCEEDED",
    } as const;
  } finally {
    // A missing/changed barrier fails the case; still drain this invocation under its original stop budget.
    if (!settled) abort.abort();
    await pending.catch(() => undefined);
  }
}

function capabilitySnapshot(path: string): Buffer | null {
  try {
    readMediaCapability(path, () => {});
    return readRuntimeMetadata(path, () => {});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** A serialized or forged object cannot mint the module-private receipt authority. */
export async function checkRejectedTargetSeal() {
  requireTrue(RUNTIME_TARGET !== null);
  const path = fixedMediaPlatformRoles(
    RUNTIME_ROOTS,
    "darwin-arm64",
  ).capability;
  const before = capabilitySnapshot(path);
  const rejected = await sealOfflineCandidate(
    Object.freeze({}) as OfflineCandidateReceipt,
  );
  requireTrue(
    rejected.outcome === "failed" &&
      rejected.code === "RECEIPT_INVALID" &&
      rejected.capabilityCommitted === false &&
      rejected.recordCommitted === false,
  );
  const after = capabilitySnapshot(path);
  requireTrue(
    before === null ? after === null : after !== null && before.equals(after),
  );
  return {
    ordinaryCapabilityUntouched: true,
    receiptRejected: true,
    capabilityCommitted: false,
  } as const;
}
