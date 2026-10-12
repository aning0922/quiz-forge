import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mediaStopFailureCode } from "../../contracts";
import { beginMediaImage } from "../../operation-context";
import { classifySystemError } from "./diagnostic";
export type CommandFailureReason =
  | "CANCELLED"
  | "DEADLINE_EXCEEDED"
  | "WORKER_FAILED"
  | "OUTPUT_INVALID"
  | "STOP_UNCONFIRMED";
export type CommandOptions = {
  deadline?: number;
  input?: Uint8Array;
  settleDeadline?: number;
  stdoutLimit?: number;
  stderrLimit?: number;
  signal?: AbortSignal;
  onSpawn?: (child: ChildProcessWithoutNullStreams) => void;
  env?: NodeJS.ProcessEnv;
  scope?: NonNullable<ReturnType<typeof beginMediaImage>>;
  phase?: "execution" | "cleanup";
};
export type CommandResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  reason: CommandFailureReason | undefined;
  stdout: Buffer;
  stdoutBytes: number;
  stderrBytes: number;
  stderrCategory: string;
  stderrSyscall: string | null;
  stderrDetails: Pick<
    ReturnType<typeof classifySystemError>,
    "errno" | "fifoOperation" | "reference"
  >;
  settled: boolean;
};
/** Local CLI exit/kill never supplies the owned stdio close fact. No raw stderr escapes. */
export function command(
  binary: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  const { input, onSpawn, scope, env } = options;
  const phase = options.phase ?? "execution";
  const initial = scope?.readState();
  const scopeDeadline =
    phase === "cleanup" && initial?.phase === "stopping"
      ? initial.stop.cleanupDeadlineMonotonicMs
      : (scope?.deadlineMonotonicMs ?? Infinity);
  const deadline = Math.min(
    options.deadline ?? performance.now() + 5000,
    scopeDeadline,
  );
  const settleDeadline = options.settleDeadline ?? deadline + 250;
  // Cleanup controls must still run after cancellation, under that same stop budget.
  const signal =
    phase === "cleanup" ? undefined : (scope?.signal ?? options.signal);
  const stdoutLimit = options.stdoutLimit ?? 16384,
    stderrLimit = options.stderrLimit ?? 4096;
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams | undefined;
    let reason: CommandFailureReason | undefined;
    const out: Buffer[] = [];
    let outBytes = 0,
      errBytes = 0;
    let stderrCategory = "empty",
      stderrSyscall: string | null = null;
    const stderrDetails: CommandResult["stderrDetails"] = {
      errno: null,
      fifoOperation: null,
      reference: null,
    };
    let finished = false;
    let timer: NodeJS.Timeout | undefined,
      hardTimer: NodeJS.Timeout | undefined,
      poll: NodeJS.Timeout | undefined;
    const sharedInterruption = (): CommandFailureReason | undefined => {
      if (phase === "cleanup") return undefined;
      const state = scope?.readState();
      return state?.phase === "stopping"
        ? mediaStopFailureCode(state.stop)
        : undefined;
    };
    const effectiveSettleDeadline = () => {
      const state = scope?.readState();
      return state?.phase === "stopping"
        ? Math.min(settleDeadline, state.stop.cleanupDeadlineMonotonicMs)
        : settleDeadline;
    };
    const finish = (
      code: number | null,
      signalName: NodeJS.Signals | null,
      closed = true,
    ) => {
      if (finished) return;
      finished = true;
      const finalDeadline = effectiveSettleDeadline();
      reason ??=
        sharedInterruption() ??
        (signal?.aborted
          ? "CANCELLED"
          : performance.now() >= deadline
            ? "DEADLINE_EXCEEDED"
            : undefined);
      if (timer) clearTimeout(timer);
      if (hardTimer) clearTimeout(hardTimer);
      if (poll) clearInterval(poll);
      signal?.removeEventListener("abort", cancel);
      resolve({
        code,
        signal: signalName,
        reason,
        stdout: Buffer.concat(out),
        stdoutBytes: outBytes,
        stderrBytes: errBytes,
        stderrCategory,
        stderrSyscall,
        stderrDetails,
        settled: closed && performance.now() <= finalDeadline,
      });
    };
    const armHardDeadline = () => {
      if (hardTimer) clearTimeout(hardTimer);
      if (finished) return;
      const end = effectiveSettleDeadline();
      if (performance.now() >= end) {
        reason ??= "DEADLINE_EXCEEDED";
        child?.stdin.destroy();
        child?.stdout.destroy();
        child?.stderr.destroy();
        finish(null, null, false);
        return;
      }
      hardTimer = setTimeout(
        armHardDeadline,
        Math.max(1, Math.ceil(end - performance.now())),
      );
    };
    const stop = (why: CommandFailureReason) => {
      if (finished) return;
      reason ??= why;
      scope?.requestStop(
        why === "STOP_UNCONFIRMED"
          ? "STOP_UNCONFIRMED"
          : why === "CANCELLED"
            ? "CANCELLED"
            : why === "DEADLINE_EXCEEDED"
              ? "IMAGE_DEADLINE_EXCEEDED"
              : "RUNTIME_FAILED",
      );
      // Tightening must apply before any more command/control work.
      armHardDeadline();
      if (finished) return;
      child?.stdin.destroy();
      try {
        child?.kill("SIGKILL");
      } catch {
        /* Only actual close can settle. */
      }
    };
    const cancel = () => {
      if (!reason) stop(sharedInterruption() ?? "CANCELLED");
    };
    const armExecutionDeadline = () => {
      if (finished) return;
      if (performance.now() >= deadline) stop("DEADLINE_EXCEEDED");
      else
        timer = setTimeout(
          armExecutionDeadline,
          Math.max(1, Math.ceil(deadline - performance.now())),
        );
    };
    if (
      !Number.isFinite(deadline) ||
      !Number.isFinite(settleDeadline) ||
      !Number.isSafeInteger(stdoutLimit) ||
      stdoutLimit < 0 ||
      !Number.isSafeInteger(stderrLimit) ||
      stderrLimit < 0
    ) {
      reason = "WORKER_FAILED";
      finish(null, null);
      return;
    }
    scope?.readState();
    if (performance.now() >= deadline || signal?.aborted) {
      reason =
        sharedInterruption() ??
        (performance.now() >= deadline ? "DEADLINE_EXCEEDED" : "CANCELLED");
      finish(null, null);
      return;
    }
    armExecutionDeadline();
    armHardDeadline();
    if (finished) return;
    try {
      child = spawn(binary, [...args], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: env ?? {
          PATH: "/usr/bin:/bin",
          LANG: "C.UTF-8",
          NODE_ENV: "production",
        },
      });
    } catch {
      reason = "WORKER_FAILED";
      finish(null, null);
      return;
    }
    signal?.addEventListener("abort", cancel, { once: true });
    child.on("error", () => stop("WORKER_FAILED"));
    // A closed input pipe does not establish client/worker close. Keep observing
    // the owned command until its original deadline rather than killing attach early.
    child.stdin.on("error", () => {
      reason ??= "WORKER_FAILED";
    });
    child.stdout.on("error", () => stop("WORKER_FAILED"));
    child.stderr.on("error", () => stop("WORKER_FAILED"));
    child.stdout.on("data", (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > stdoutLimit) stop("OUTPUT_INVALID");
      else out.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const classified = classifySystemError(chunk.toString("utf8"));
      if (stderrCategory === "empty" || stderrCategory === "unclassified")
        stderrCategory = classified.category;
      stderrSyscall ??= classified.knownSyscall;
      for (const key of ["errno", "fifoOperation", "reference"] as const)
        stderrDetails[key] ??= classified[key];
      errBytes += chunk.length;
      if (errBytes > stderrLimit) stop("OUTPUT_INVALID");
    });
    child.once("close", (code, signalName) => finish(code, signalName));
    if (scope)
      poll = setInterval(() => {
        effectiveSettleDeadline();
        if (signal?.aborted) cancel();
        armHardDeadline();
      }, 20);
    try {
      onSpawn?.(child);
    } catch {
      stop("WORKER_FAILED");
    }
    if (signal?.aborted) cancel();
    if (!reason && !finished) child.stdin.end(input);
  });
}
