import { createTrustedMediaRuntime } from "../../../src/features/quizpack/server/media/internal/runtime";
import {
  runOwnedMac,
  type MacExecution,
  type MacExecutionResult,
} from "../../../src/features/quizpack/server/media/internal/macos/execute";
import {
  createMediaOperationContext,
  beginMediaImage,
  readMediaOperationState,
  disposeMediaOperationContext,
} from "../../../src/features/quizpack/server/media/operation-context";
import { mediaStopFailureCode } from "../../../src/features/quizpack/server/media/contracts";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  MEDIA_LIMITS,
  type ImageDeclaration,
  type LaunchContext,
  type LaunchFailureCode,
  type LaunchResult,
} from "../shared/contracts";
import { precheckImage } from "../shared/precheck";
import { parseWorkerOutput } from "../shared/output";
import { acquireControl } from "./control";
import {
  loadPolicy,
  PolicyError,
  WORKER,
  FAULT_WORKER,
  POSIX_PROBE,
  MAC_PROBE,
  MAC_IDENTITY_HELPER,
  REPO_ROOT,
  MAC_ROOT,
  RUNTIME_TARGET,
  RUNTIME_ROOTS,
  type Policy,
  policySupported,
  policyComponentId,
} from "./policy";
import { join } from "node:path";
function contextSnapshot(
  context: LaunchContext,
  start: number,
): { signal: AbortSignal; deadline: number } | null {
  try {
    if (
      !(context.signal instanceof AbortSignal) ||
      !Number.isFinite(context.deadlineMonotonicMs)
    )
      return null;
    return {
      signal: context.signal,
      deadline: Math.min(
        context.deadlineMonotonicMs,
        start + MEDIA_LIMITS.executionMs,
      ),
    };
  } catch {
    return null;
  }
}
async function runOwned(
  runId: string,
  execution: MacExecution,
  ctx: { signal: AbortSignal; deadline: number },
  start: number,
): Promise<MacExecutionResult> {
  const context = createMediaOperationContext({
    signal: ctx.signal,
    deadlineMonotonicMs: ctx.deadline,
  });
  const scope = beginMediaImage(context);
  try {
    if (!scope) {
      const state = readMediaOperationState(context);
      return {
        runId,
        profileId: execution.policy.profileId,
        code:
          state.phase === "stopping"
            ? mediaStopFailureCode(state.stop)
            : "BUSY",
        stopped: "not-started",
        output: Buffer.alloc(0),
        elapsedMs: performance.now() - start,
        residentBytes: 0,
        peakFootprintBytes: 0,
        workerObserved: false,
        exitCode: null,
        lateClose: Promise.resolve(),
      };
    }
    return await runOwnedMac(runId, execution, scope, start, {
      checkoutRoot: REPO_ROOT,
      identityHelper: MAC_IDENTITY_HELPER,
      acquireControl,
    });
  } finally {
    scope?.finish();
    disposeMediaOperationContext(context);
  }
}
function failed(
  runId: string,
  profileId: string | null,
  code: LaunchFailureCode,
  stopped: "not-started" | "confirmed" | "unknown" = "not-started",
): LaunchResult {
  return { outcome: "failed", runId, profileId, code, stopped };
}
/** Experimental candidate only; not wired to P1 or any business request. */
async function runImage(
  bytes: Uint8Array,
  expected: ImageDeclaration,
  context: LaunchContext,
  capability: "sealed" | "harness" | { candidateComponentId: string },
): Promise<LaunchResult> {
  const start = performance.now(),
    runId = randomUUID();
  const input = precheckImage(bytes, expected),
    ctx = contextSnapshot(context, start);
  if (!input.ok) return failed(runId, null, input.code);
  if (!ctx) return failed(runId, null, "INVALID_INPUT");
  if (ctx.signal.aborted) return failed(runId, null, "CANCELLED");
  if (performance.now() >= ctx.deadline)
    return failed(runId, null, "DEADLINE_EXCEEDED");
  if (RUNTIME_TARGET) {
    if (typeof capability === "object") {
      try {
        if (policyComponentId(loadPolicy()) !== capability.candidateComponentId)
          return failed(runId, null, "ISOLATION_UNAVAILABLE");
      } catch (error) {
        return failed(
          runId,
          null,
          error instanceof PolicyError ? error.code : "ISOLATION_UNAVAILABLE",
        );
      }
    }
    const operation = createMediaOperationContext({
      signal: ctx.signal,
      deadlineMonotonicMs: ctx.deadline,
    });
    try {
      return await createTrustedMediaRuntime(RUNTIME_ROOTS).run(
        input.bytes,
        input.expected,
        operation,
        capability === "sealed" ? "sealed" : "candidate",
      );
    } finally {
      disposeMediaOperationContext(operation);
    }
  }
  let policy: Policy;
  try {
    policy = loadPolicy();
  } catch (error) {
    return failed(
      runId,
      null,
      error instanceof PolicyError ? error.code : "ISOLATION_UNAVAILABLE",
    );
  }
  if (
    (capability === "sealed" && !policySupported(policy)) ||
    (typeof capability === "object" &&
      policyComponentId(policy) !== capability.candidateComponentId)
  )
    return failed(runId, policy.profileId, "ISOLATION_UNAVAILABLE");
  // Execution identity includes the trusted control helper; no helper means closed.
  const result = await runOwned(
    runId,
    {
      executable: policy.node,
      args: [
        WORKER,
        String(MEDIA_LIMITS.bytes),
        String(MEDIA_LIMITS.dimension),
        String(MEDIA_LIMITS.pixels),
      ],
      bytes: input.bytes,
      policy,
    },
    ctx,
    start,
  );
  if (result.code)
    return failed(runId, result.profileId, result.code, result.stopped);
  const parsed = parseWorkerOutput(result.output, input.expected);
  if (!parsed.ok)
    return failed(runId, result.profileId, parsed.code, result.stopped);
  if (result.stopped !== "confirmed")
    return failed(runId, result.profileId, "STOP_UNCONFIRMED", "unknown");
  if (ctx.signal.aborted || performance.now() >= ctx.deadline)
    return failed(
      runId,
      result.profileId,
      ctx.signal.aborted ? "CANCELLED" : "DEADLINE_EXCEEDED",
      "confirmed",
    );
  return {
    outcome: "decoded",
    runId,
    profileId: result.profileId,
    facts: parsed.facts,
    stopped: "confirmed",
  };
}
export function runIsolatedImage(
  bytes: Uint8Array,
  expected: ImageDeclaration,
  context: LaunchContext,
): Promise<LaunchResult> {
  return runImage(bytes, expected, context, "sealed");
}
/** Closed offline capability matrix only: fixed original P1 worker and identical policy. */
export function runHarnessImage(
  bytes: Uint8Array,
  expected: ImageDeclaration,
  context: LaunchContext,
): Promise<LaunchResult> {
  return runImage(bytes, expected, context, "harness");
}

/** Private pre-seal gate, ignored by the ordinary entry; uses identical launch path. */
export function runHarnessCandidateImage(
  bytes: Uint8Array,
  expected: ImageDeclaration,
  context: LaunchContext,
  candidateComponentId: string,
): Promise<LaunchResult> {
  return runImage(bytes, expected, context, { candidateComponentId });
}

export type HarnessCase =
  | {
      kind: "fault";
      scenario:
        | "stdout"
        | "stderr"
        | "invalid"
        | "multiple"
        | "extra"
        | "bom"
        | "nonzero"
        | "crash"
        | "success-hang"
        | "backpressure"
        | "identity-hang"
        | "parent-crash"
        | "unknown-stop"
        | "environment";
    }
  | {
      kind: "files";
      zone: "runtime" | "admin" | "PGDATA" | "uploads";
      alias: "direct" | "dots" | "symlink" | "hardlink";
    }
  | {
      kind:
        | "process"
        | "fd"
        | "vfork"
        | "fd-data"
        | "listen"
        | "identity-peer"
        | "spawn-self";
    }
  | { kind: "network"; port: number }
  | { kind: "ipc"; nonce: string; peerPid: number };
/** Private closed harness: every filesystem argument derives from the fixed synthetic fixture root.
 * No command/path/env parameters, no package-supplied executable. */
export async function runHarnessCase(
  spec: HarnessCase,
  context: LaunchContext,
): Promise<MacExecutionResult> {
  const start = performance.now(),
    runId = randomUUID(),
    ctx = contextSnapshot(context, start);
  if (!ctx) throw new Error("INVALID_SYNTHETIC_CONTEXT");
  const kind =
    spec.kind === "fault"
      ? "fault"
      : [
            "vfork",
            "fd-data",
            "listen",
            "ipc",
            "identity-peer",
            "spawn-self",
          ].includes(spec.kind)
        ? "mac"
        : "posix";
  const policy = loadPolicy(kind);
  const executable =
    kind === "fault" ? policy.node : kind === "mac" ? MAC_PROBE : POSIX_PROBE;
  let args: string[],
    bytes = Buffer.alloc(0);
  if (spec.kind === "fault") {
    args = [FAULT_WORKER, spec.scenario];
    if (spec.scenario === "backpressure")
      bytes = Buffer.alloc(MEDIA_LIMITS.bytes);
  } else if (spec.kind === "files") {
    const base = join(MAC_ROOT, "fixtures");
    const zone =
      spec.alias === "symlink"
        ? `${spec.zone}-symlink`
        : spec.alias === "hardlink"
          ? `${spec.zone}-hardlink`
          : spec.zone;
    const path =
      spec.alias === "dots"
        ? `${base}//${zone}/../${zone}/.`
        : join(base, zone);
    args = ["files", path];
  } else if (spec.kind === "network") {
    if (!Number.isInteger(spec.port) || spec.port < 1 || spec.port > 65535)
      throw new Error("INVALID_SYNTHETIC_CONTEXT");
    args = [
      "network",
      String(spec.port),
      ".cache/quizpack-media-preflight/macos/fixtures/peer.sock",
    ];
  } else if (spec.kind === "ipc") {
    if (
      !/^[a-f0-9]{16}$/.test(spec.nonce) ||
      !Number.isSafeInteger(spec.peerPid) ||
      spec.peerPid <= 0
    )
      throw new Error("INVALID_SYNTHETIC_CONTEXT");
    args = [
      "ipc",
      `org.quizforge.media.${spec.nonce}`,
      `/qf-${spec.nonce}`,
      String(spec.peerPid),
    ];
  } else if (spec.kind === "identity-peer")
    args = ["identity", String(process.pid), String(process.pid), policy.node];
  else args = [spec.kind];
  return runOwned(runId, { executable, args, bytes, policy }, ctx, start);
}
