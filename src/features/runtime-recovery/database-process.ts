import "server-only";
import { spawn } from "node:child_process";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
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
  return executeRecoveryPg(program, args, budget, options, false);
}

async function executeRecoveryPg(
  program: string,
  args: readonly string[],
  budget: RecoveryBudget,
  options: {
    env?: Record<string, string>;
    input?: FileHandle;
    output?: FileHandle;
  },
  ownedStop: boolean,
): Promise<string> {
  const check = () => {
    if (!ownedStop) {
      checkRecoveryBudget(budget);
      assertRecoveryProcessesKnown();
    } else if (
      budget.signal.aborted ||
      performance.now() >= budget.deadlineMonotonicMs
    ) {
      throw new RecoveryError("RECOVERY_INTERRUPTED");
    }
  };
  check();
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
      options.input ? "pipe" : "ignore",
      options.output?.fd ?? "pipe",
      "pipe",
    ],
  });
  let bad = false,
    bytes = 0,
    stdout = "",
    spawned = false,
    exited = false,
    closed = false,
    inspecting: Promise<void> | undefined;
  child.once("spawn", () => {
    spawned = true;
    if (bad || budget.signal.aborted) stop();
  });
  child.once("exit", () => {
    exited = true;
  });
  const signal = (value: NodeJS.Signals) => {
    if (!spawned || exited || closed) return;
    try {
      if (child.pid) process.kill(-child.pid, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") unknown.add(child);
    }
  };
  let killer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    bad = true;
    if (!spawned || exited || closed) return;
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
  // Explicit-position reads preserve the borrowed descriptor's shared offset.
  child.stdin?.on("error", () => {});
  const pumping = options.input
    ? (async () => {
        const buffer = Buffer.alloc(65536);
        let position = 0;
        try {
          while (!closed && child.stdin && !child.stdin.destroyed) {
            const part = await options.input!.read(
              buffer,
              0,
              buffer.length,
              position,
            );
            if (!part.bytesRead || closed) break;
            position += part.bytesRead;
            if (position > RECOVERY_LIMITS.dumpBytes) {
              stop();
              break;
            }
            const written = await new Promise<boolean>((resolve) =>
              child.stdin!.write(buffer.subarray(0, part.bytesRead), (error) =>
                resolve(!error),
              ),
            );
            if (!written) break; // Successful --list may close input after its finite TOC.
          }
          if (child.stdin && !child.stdin.destroyed) child.stdin.end();
        } catch {
          stop();
        }
      })()
    : Promise.resolve();
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
      exited = true;
      closed = true;
      resolve({ code, signal: value });
    });
  });
  clearTimeout(timeout);
  clearInterval(poll);
  budget.signal.removeEventListener("abort", stop);
  try {
    await pumping; // All issued file reads and pipe writes settle before returning.
    await inspecting;
  } finally {
    clearTimeout(killer);
  }
  let closeUnproven = false;
  if (spawned && child.pid) {
    // A closed leader no longer authorizes destructive signals to its old PID/group.
    if (!absentGroup(child.pid)) {
      unknown.add(child);
      closeUnproven = true;
    }
  }
  if (!closed) unknown.add(child);
  if (closeUnproven || !closed)
    throw new RecoveryError("RECOVERY_CLOSE_UNPROVEN");
  if (!ownedStop) assertRecoveryProcessesKnown();
  if (bad || !spawned || outcome.code !== 0 || outcome.signal)
    throw new RecoveryError("RECOVERY_PROCESS_FAILED");
  check();
  return stdout;
}

export function recoveryPgRunner(budget: RecoveryBudget): PgCommandRunner {
  // initializeLocalInstance/startPostgres may need their already-owned stop
  // authority before the initializer has returned a manifest to the caller.
  // Cleanup remains finite but must not reuse the expired admission signal.
  return (program, args) => {
    const id = path.basename(path.dirname(args[1] ?? ""));
    const ownedStop =
      program === "pg_ctl" &&
      /^[a-f0-9]{32}$/.test(id) &&
      args[1] === path.join(process.cwd(), ".cache", "p2a", id, "pgdata") &&
      JSON.stringify(args) ===
        JSON.stringify(["-D", args[1], "-w", "-t", "5", "-m", "fast", "stop"]);
    // This exact command is issued only after stopStartedPostgres rechecks the
    // original PID/start time/optional launch tag. It grants no new business IO.
    return executeRecoveryPg(
      program,
      args,
      ownedStop
        ? {
            deadlineMonotonicMs: performance.now() + 15000,
            signal: new AbortController().signal,
          }
        : budget,
      {},
      ownedStop,
    );
  };
}
