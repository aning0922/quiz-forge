import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { z } from "zod";
import { identitySchema, parseNativeIdentity } from "./protocol";
import {
  MEDIA_LIMITS,
  type ImageDeclaration,
  type LaunchContext,
  type LaunchFailureCode,
  type LaunchResult,
} from "../shared/contracts";
import { precheckImage } from "../shared/precheck";
import { parseWorkerOutput } from "../shared/output";
import { acquireControl, ControlError } from "./control";
import {
  loadPolicy,
  PolicyError,
  SANDBOX,
  WORKER,
  FAULT_WORKER,
  POSIX_PROBE,
  MAC_PROBE,
  MAC_IDENTITY_HELPER,
  REPO_ROOT,
  MAC_ROOT,
  type Policy,
  policySupported,
  policyComponentId,
} from "./policy";
import { join } from "node:path";
type Identity = Extract<z.infer<typeof identitySchema>, { present: true }>;
function inspectOwned(pid: number, executable: string): Identity | null {
  const r = spawnSync(
    MAC_IDENTITY_HELPER,
    ["identity", String(pid), String(process.pid), executable],
    {
      env: { NODE_ENV: "production" },
      cwd: REPO_ROOT,
      timeout: 100,
      maxBuffer: 2048,
    },
  );
  if (r.status !== 0) return null;
  const parsed = parseNativeIdentity(r.stdout);
  return parsed?.present && parsed.owned ? parsed : null;
}
type Execution = {
  executable: string;
  args: string[];
  bytes: Buffer;
  policy: Policy;
};
type ExecutionResult = {
  runId: string;
  profileId: string;
  code: LaunchFailureCode | null;
  stopped: "not-started" | "confirmed" | "unknown";
  output: Buffer;
  elapsedMs: number;
  residentBytes: number;
  peakFootprintBytes: number;
  workerObserved: boolean;
  exitCode: number | null;
  lateClose: Promise<void>;
};
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
  execution: Execution,
  ctx: { signal: AbortSignal; deadline: number },
  start: number,
): Promise<ExecutionResult> {
  const { policy } = execution;
  const basic = {
    runId,
    profileId: policy.profileId,
    output: Buffer.alloc(0),
    elapsedMs: performance.now() - start,
    residentBytes: 0,
    peakFootprintBytes: 0,
    workerObserved: false,
    exitCode: null,
    lateClose: Promise.resolve(),
  };
  const interruption = (): LaunchFailureCode | null =>
    ctx.signal.aborted
      ? "CANCELLED"
      : performance.now() >= ctx.deadline
        ? "DEADLINE_EXCEEDED"
        : null;
  const before = interruption();
  if (before) return { ...basic, code: before, stopped: "not-started" };
  let control: ReturnType<typeof acquireControl>;
  try {
    control = acquireControl(runId, policy.profileId);
  } catch (error) {
    return {
      ...basic,
      code:
        error instanceof ControlError ? error.code : "ISOLATION_UNAVAILABLE",
      stopped: "not-started",
    };
  }
  const after = interruption();
  if (after) {
    try {
      control.finish();
    } catch {
      return { ...basic, code: "STOP_UNCONFIRMED", stopped: "unknown" };
    }
    return { ...basic, code: after, stopped: "not-started" };
  }
  return new Promise((resolve) => {
    let actualClose: () => void = () => {};
    const lateClose = new Promise<void>((settled) => {
      actualClose = settled;
    });
    let forced: LaunchFailureCode | null = null,
      closed = false,
      finished = false,
      cleanupTimer: NodeJS.Timeout | undefined;
    let resident = 0,
      footprint = 0,
      workerObserved = false,
      identity: Identity | null = null;
    let stdoutBytes = 0,
      stderrBytes = 0;
    const chunks: Buffer[] = [];
    let child: ReturnType<typeof spawn>;
    // Persist issued state BEFORE the platform operation. Crash in any later gap blocks restart.
    try {
      control.update("issued");
      // Persistence is synchronous and can consume the remaining absolute budget.
      const persistedInterruption = interruption();
      if (persistedInterruption) {
        try {
          control.finish();
          resolve({
            ...basic,
            code: persistedInterruption,
            stopped: "not-started",
          });
        } catch {
          resolve({ ...basic, code: "STOP_UNCONFIRMED", stopped: "unknown" });
        }
        return;
      }
      child = spawn(
        SANDBOX,
        ["-p", policy.profile, execution.executable, ...execution.args],
        {
          cwd: REPO_ROOT,
          env: { NODE_ENV: "production" },
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    } catch {
      try {
        control.update("unknown");
      } catch {}
      resolve({ ...basic, code: "STOP_UNCONFIRMED", stopped: "unknown" });
      return;
    }
    const observe = () => {
      if (closed || !child.pid) return null;
      const found = inspectOwned(child.pid, execution.executable);
      if (
        !found ||
        (identity &&
          (found.startSec !== identity.startSec ||
            found.startUsec !== identity.startUsec))
      )
        return null;
      if (!identity) {
        identity = found;
        try {
          control.update("spawned", child.pid, {
            sec: found.startSec,
            usec: found.startUsec,
          });
        } catch {
          forced ??= "STOP_UNCONFIRMED";
        }
      }
      resident = Math.max(resident, found.residentBytes);
      footprint = Math.max(footprint, found.peakFootprintBytes);
      if (found.executable === "worker") workerObserved = true;
      return found;
    };
    const finish = (stopped: "confirmed" | "unknown") => {
      if (finished) return;
      finished = true;
      clearTimeout(deadlineTimer);
      clearInterval(poll);
      if (cleanupTimer) clearTimeout(cleanupTimer);
      ctx.signal.removeEventListener("abort", cancel);
      let finalStopped = stopped;
      try {
        if (stopped === "confirmed") control.finish();
        else control.update("unknown");
      } catch {
        finalStopped = "unknown";
      }
      resolve({
        runId,
        profileId: policy.profileId,
        code: finalStopped === "unknown" ? "STOP_UNCONFIRMED" : forced,
        stopped: finalStopped,
        output: Buffer.concat(chunks),
        elapsedMs: performance.now() - start,
        residentBytes: resident,
        peakFootprintBytes: footprint,
        workerObserved,
        exitCode: child.exitCode,
        lateClose,
      });
    };
    const terminate = (code: LaunchFailureCode) => {
      forced ??= code;
      child.stdin?.destroy();
      if (!cleanupTimer)
        cleanupTimer = setTimeout(
          () => finish("unknown"),
          MEDIA_LIMITS.cleanupMs,
        );
      if (!closed && child.exitCode === null && child.signalCode === null) {
        const known = observe();
        if (
          known &&
          (known.executable === "worker" || known.executable === "sandbox")
        )
          try {
            child.kill("SIGKILL");
          } catch {
            /* Keep the owned identity; only close can confirm stop. */
          }
      }
    };
    const cancel = () => terminate("CANCELLED");
    const deadlineTimer = setTimeout(
      () => terminate("DEADLINE_EXCEEDED"),
      Math.max(0, ctx.deadline - performance.now()),
    );
    const poll = setInterval(() => {
      observe();
      const reason = interruption();
      if (reason) terminate(reason);
    }, 20);
    ctx.signal.addEventListener("abort", cancel, { once: true });
    child.once("spawn", () => {
      try {
        control.update("spawned", child.pid ?? null);
      } catch {
        terminate("STOP_UNCONFIRMED");
      }
      observe();
    });
    child.once("error", () => {
      terminate("WORKER_FAILED");
    });
    child.stdin?.on("error", () => terminate("WORKER_FAILED"));
    child.stdout?.on("error", () => terminate("WORKER_FAILED"));
    child.stderr?.on("error", () => terminate("WORKER_FAILED"));
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes = Math.min(
        MEDIA_LIMITS.stdoutBytes + 1,
        stdoutBytes + chunk.length,
      );
      if (stdoutBytes > MEDIA_LIMITS.stdoutBytes) terminate("OUTPUT_INVALID");
      else chunks.push(Buffer.from(chunk));
      const reason = interruption();
      if (reason) terminate(reason);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes = Math.min(
        MEDIA_LIMITS.stderrBytes + 1,
        stderrBytes + chunk.length,
      );
      if (stderrBytes > MEDIA_LIMITS.stderrBytes) terminate("WORKER_FAILED");
    });
    // ChildProcess close occurs after actual exit and ALL stdio closure, not on kill/JSON.
    child.once("close", (code, signal) => {
      closed = true;
      actualClose();
      const reason = interruption();
      if (reason) forced ??= reason;
      if ((code !== 0 || signal) && !forced) forced = "WORKER_FAILED";
      finish("confirmed");
    });
    const reason = interruption();
    if (reason) terminate(reason);
    else child.stdin?.end(execution.bytes);
  });
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
): Promise<ExecutionResult> {
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
