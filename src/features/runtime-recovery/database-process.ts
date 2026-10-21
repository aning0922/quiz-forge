import "server-only";
import { spawn } from "node:child_process";
import type { FileHandle } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { PgCommandRunner } from "@/lib/db/pg-command";
import type { RecoveryBudget } from "./ports";
import { RECOVERY_LIMITS } from "./contracts";
import { checkRecoveryBudget } from "./files";
import { RecoveryError } from "./errors";

const programs = new Set([
  "postgres",
  "initdb",
  "pg_ctl",
  "pg_dump",
  "pg_restore",
]);
const unknown = new Set<object>();
export function assertRecoveryProcessesKnown(): void {
  if (unknown.size) throw new RecoveryError("RECOVERY_CLOSE_UNPROVEN");
}
function absentGroup(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/** Fixed local binaries, no shell/DSN/raw stderr. A result requires real child and pipe close. */
export async function runRecoveryPg(
  program: string,
  args: readonly string[],
  budget: RecoveryBudget,
  options: {
    env?: Record<string, string>;
    input?: FileHandle;
    output?: FileHandle;
  } = {},
): Promise<string> {
  checkRecoveryBudget(budget);
  assertRecoveryProcessesKnown();
  if (!programs.has(program))
    throw new RecoveryError("RECOVERY_ARGUMENTS_INVALID");
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("PG")) delete env[key];
  Object.assign(env, options.env);
  const child = spawn(`/opt/homebrew/bin/${program}`, [...args], {
    cwd: process.cwd(),
    env,
    detached: true,
    stdio: [
      options.input?.fd ?? "ignore",
      options.output?.fd ?? "pipe",
      "pipe",
    ],
  });
  let bad = false,
    bytes = 0,
    stdout = "",
    spawned = false,
    closed = false,
    inspecting: Promise<void> | undefined;
  child.once("spawn", () => {
    spawned = true;
  });
  const signal = (value: NodeJS.Signals) => {
    try {
      if (child.pid) process.kill(-child.pid, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") unknown.add(child);
    }
  };
  let killer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    bad = true;
    signal("SIGTERM");
    killer ??= setTimeout(() => signal("SIGKILL"), 2000);
  };
  const timeout = setTimeout(
    stop,
    Math.max(1, budget.deadlineMonotonicMs - performance.now()),
  );
  budget.signal.addEventListener("abort", stop, { once: true });
  const collect = (chunk: Buffer, isStdout: boolean) => {
    bytes += chunk.length;
    if (bytes > 2_097_152) stop();
    else if (isStdout) stdout += chunk.toString("utf8");
  };
  child.stdout?.on("data", (chunk: Buffer) => collect(chunk, true));
  child.stderr?.on("data", (chunk: Buffer) => collect(chunk, false));
  child.once("error", () => {
    bad = true;
  });
  const poll = options.output
    ? setInterval(() => {
        if (inspecting) return;
        inspecting = options
          .output!.stat()
          .then((stat) => {
            if (stat.size > RECOVERY_LIMITS.dumpBytes) stop();
          }, stop)
          .finally(() => {
            inspecting = undefined;
          });
      }, 25)
    : undefined;
  const outcome = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once("close", (code, value) => {
      closed = true;
      resolve({ code, signal: value });
    });
  });
  clearTimeout(timeout);
  clearTimeout(killer);
  clearInterval(poll);
  budget.signal.removeEventListener("abort", stop);
  await inspecting;
  if (spawned && child.pid) {
    const deadline = performance.now() + 2000;
    while (!absentGroup(child.pid) && performance.now() < deadline) {
      signal("SIGKILL");
      await delay(10);
    }
    if (!absentGroup(child.pid)) unknown.add(child);
  }
  if (!closed) unknown.add(child);
  assertRecoveryProcessesKnown();
  if (bad || !spawned || outcome.code !== 0 || outcome.signal)
    throw new RecoveryError("RECOVERY_PROCESS_FAILED");
  checkRecoveryBudget(budget);
  return stdout;
}

export function recoveryPgRunner(budget: RecoveryBudget): PgCommandRunner {
  return (program, args) => runRecoveryPg(program, args, budget);
}
