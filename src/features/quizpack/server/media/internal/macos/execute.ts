import "server-only";
import { spawn, spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import type { z } from "zod";
import { identitySchema, parseNativeIdentity } from "./identity-protocol";
import {
  MEDIA_LIMITS,
  mediaStopFailureCode,
  type LaunchFailureCode,
} from "../../contracts";
import { beginMediaImage } from "../../operation-context";
export type MacExecutionScope = NonNullable<ReturnType<typeof beginMediaImage>>;
export type MacOwnedControl = {
  update(
    phase: "prepared" | "issued" | "spawned" | "unknown",
    pid?: number | null,
    start?: { sec: number; usec: number } | null,
  ): void;
  finish(deadlineMonotonicMs?: number): void;
};
export type MacExecutionEnvironment = {
  checkoutRoot: string;
  identityHelper: string;
  acquireControl: (runId: string, profileId: string) => MacOwnedControl;
};
import { MacControlError } from "./control-errors";
export { MacControlError };
type Identity = Extract<z.infer<typeof identitySchema>, { present: true }>;
function inspectOwned(
  env: MacExecutionEnvironment,
  pid: number,
  executable: string,
  deadline: number,
): Identity | null {
  const timeout = Math.min(100, Math.floor(deadline - performance.now()));
  if (timeout < 1) return null;
  const r = spawnSync(
    env.identityHelper,
    ["identity", String(pid), String(process.pid), executable],
    {
      env: { NODE_ENV: "production" },
      cwd: env.checkoutRoot,
      timeout,
      maxBuffer: 2048,
    },
  );
  if (r.status !== 0) return null;
  const parsed = parseNativeIdentity(r.stdout);
  return parsed?.present && parsed.owned ? parsed : null;
}
export type MacExecution = {
  executable: string;
  args: string[];
  bytes: Buffer;
  policy: { profile: string; profileId: string };
};
export type MacExecutionResult = {
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
export async function runOwnedMac(
  runId: string,
  execution: MacExecution,
  ctx: MacExecutionScope,
  start: number,
  env: MacExecutionEnvironment,
): Promise<MacExecutionResult> {
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
  const interruption = (): LaunchFailureCode | null => {
    const state = ctx.readState();
    return state.phase === "stopping" ? mediaStopFailureCode(state.stop) : null;
  };
  const before = interruption();
  if (before)
    return {
      ...basic,
      code: before,
      stopped: before === "STOP_UNCONFIRMED" ? "unknown" : "not-started",
    };
  let control: MacOwnedControl;
  try {
    control = env.acquireControl(runId, policy.profileId);
  } catch (error) {
    const stopped = interruption();
    return {
      ...basic,
      code:
        stopped ??
        (error instanceof MacControlError
          ? error.code
          : "ISOLATION_UNAVAILABLE"),
      stopped: stopped === "STOP_UNCONFIRMED" ? "unknown" : "not-started",
    };
  }
  const after = interruption();
  if (after) {
    if (after === "STOP_UNCONFIRMED")
      return { ...basic, code: after, stopped: "unknown" };
    try {
      const state = ctx.readState();
      control.finish(
        state.phase === "stopping"
          ? state.stop.cleanupDeadlineMonotonicMs
          : ctx.deadlineMonotonicMs,
      );
      const final = ctx.readState();
      if (
        final.phase === "stopping" &&
        (final.stop.reason === "STOP_UNCONFIRMED" ||
          performance.now() >= final.stop.cleanupDeadlineMonotonicMs)
      )
        throw new Error("STOP_UNCONFIRMED");
    } catch {
      ctx.requestStop("STOP_UNCONFIRMED");
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
        if (persistedInterruption === "STOP_UNCONFIRMED") {
          resolve({
            ...basic,
            code: persistedInterruption,
            stopped: "unknown",
          });
          return;
        }
        try {
          const state = ctx.readState();
          control.finish(
            state.phase === "stopping"
              ? state.stop.cleanupDeadlineMonotonicMs
              : ctx.deadlineMonotonicMs,
          );
          const final = ctx.readState();
          if (
            final.phase === "stopping" &&
            (final.stop.reason === "STOP_UNCONFIRMED" ||
              performance.now() >= final.stop.cleanupDeadlineMonotonicMs)
          )
            throw new Error("STOP_UNCONFIRMED");
          resolve({
            ...basic,
            code: persistedInterruption,
            stopped: "not-started",
          });
        } catch {
          ctx.requestStop("STOP_UNCONFIRMED");
          resolve({ ...basic, code: "STOP_UNCONFIRMED", stopped: "unknown" });
        }
        return;
      }
      child = spawn(
        "/usr/bin/sandbox-exec",
        ["-p", policy.profile, execution.executable, ...execution.args],
        {
          cwd: env.checkoutRoot,
          env: { NODE_ENV: "production" },
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    } catch {
      try {
        control.update("unknown");
      } catch {}
      ctx.requestStop("STOP_UNCONFIRMED");
      resolve({ ...basic, code: "STOP_UNCONFIRMED", stopped: "unknown" });
      return;
    }
    const observe = () => {
      if (closed || !child.pid) return null;
      const state = ctx.readState();
      const deadline =
        state.phase === "stopping"
          ? state.stop.cleanupDeadlineMonotonicMs
          : ctx.deadlineMonotonicMs;
      const found = inspectOwned(
        env,
        child.pid,
        execution.executable,
        deadline,
      );
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
          terminate("STOP_UNCONFIRMED");
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
      clearInterval(poll);
      if (cleanupTimer) clearTimeout(cleanupTimer);
      ctx.signal.removeEventListener("abort", cancel);
      const state = ctx.readState();
      const cleanupDeadline =
        state.phase === "stopping"
          ? state.stop.cleanupDeadlineMonotonicMs
          : ctx.deadlineMonotonicMs;
      const sharedUnknown =
        state.phase === "stopping" && state.stop.reason === "STOP_UNCONFIRMED";
      let finalStopped =
        sharedUnknown || performance.now() >= cleanupDeadline
          ? ("unknown" as const)
          : stopped;
      try {
        if (finalStopped === "confirmed") control.finish(cleanupDeadline);
        else if (
          state.phase !== "stopping" ||
          performance.now() < state.stop.cleanupDeadlineMonotonicMs
        )
          control.update("unknown");
      } catch {
        finalStopped = "unknown";
      }
      const final = ctx.readState();
      if (
        performance.now() >= cleanupDeadline ||
        (final.phase === "stopping" && final.stop.reason === "STOP_UNCONFIRMED")
      )
        finalStopped = "unknown";
      if (finalStopped === "unknown") ctx.requestStop("STOP_UNCONFIRMED");
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
      if (finished) return;
      forced ??= code;
      const stop = ctx.requestStop(
        code === "CANCELLED"
          ? "CANCELLED"
          : code === "DEADLINE_EXCEEDED"
            ? "IMAGE_DEADLINE_EXCEEDED"
            : code === "STOP_UNCONFIRMED"
              ? "STOP_UNCONFIRMED"
              : "RUNTIME_FAILED",
      );
      child.stdin?.destroy();
      const awaitCleanupDeadline = () => {
        const current = ctx.readState();
        const deadline =
          current.phase === "stopping"
            ? current.stop.cleanupDeadlineMonotonicMs
            : stop.cleanupDeadlineMonotonicMs;
        if (performance.now() >= deadline) finish("unknown");
        else
          cleanupTimer = setTimeout(
            awaitCleanupDeadline,
            Math.max(1, Math.ceil(deadline - performance.now())),
          );
      };
      if (!cleanupTimer) awaitCleanupDeadline();
      if (finished) return;
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
    const cancel = () => {
      if (!forced) terminate(interruption() ?? "CANCELLED");
    };
    const poll = setInterval(() => {
      const state = ctx.readState();
      if (
        state.phase === "stopping" &&
        performance.now() >= state.stop.cleanupDeadlineMonotonicMs
      ) {
        finish("unknown");
        return;
      }
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
