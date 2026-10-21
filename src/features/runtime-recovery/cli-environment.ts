import { spawn, type ChildProcess } from "node:child_process";
import { realpath } from "node:fs/promises";
import { RecoveryError } from "./errors";
import type { RecoveryBudget } from "./ports";
import { checkRecoveryBudget } from "./files";

const unknownChildren = new Set<ChildProcess>();
async function probe(
  file: string,
  args: string[],
  root: string,
  budget: RecoveryBudget,
): Promise<string> {
  checkRecoveryBudget(budget);
  if (unknownChildren.size) throw new RecoveryError("RECOVERY_CLOSE_UNPROVEN");
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_DIR: undefined,
        GIT_WORK_TREE: undefined,
        GIT_COMMON_DIR: undefined,
        GIT_OPTIONAL_LOCKS: "0",
      },
    });
    const stdout: Buffer[] = [];
    let bytes = 0;
    let failure: RecoveryError | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let unknownTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const stop = (error: RecoveryError) => {
      failure ??= error;
      if (closed || killTimer) return;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 250);
      unknownTimer = setTimeout(() => {
        if (closed) return;
        unknownChildren.add(child);
        reject(new RecoveryError("RECOVERY_CLOSE_UNPROVEN"));
      }, 2_000);
    };
    const aborted = () => stop(new RecoveryError("RECOVERY_INTERRUPTED"));
    const timer = setTimeout(
      aborted,
      Math.max(
        1,
        Math.min(5_000, budget.deadlineMonotonicMs - performance.now()),
      ),
    );
    budget.signal.addEventListener("abort", aborted, { once: true });
    if (budget.signal.aborted) aborted();
    child.stdout?.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 8192) stop(new RecoveryError("RECOVERY_LIMIT_EXCEEDED"));
      else stdout.push(Buffer.from(chunk));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 8192) stop(new RecoveryError("RECOVERY_LIMIT_EXCEEDED"));
    });
    child.on("error", () => {
      failure ??= new RecoveryError("RECOVERY_ENVIRONMENT_UNSUPPORTED");
    });
    child.once("close", (code) => {
      closed = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (unknownTimer) clearTimeout(unknownTimer);
      budget.signal.removeEventListener("abort", aborted);
      if (unknownChildren.has(child)) return; // Late close cannot restore this process's authority.
      if (failure) reject(failure);
      else if (code !== 0)
        reject(new RecoveryError("RECOVERY_ENVIRONMENT_UNSUPPORTED"));
      else resolve(Buffer.concat(stdout).toString("utf8").trim());
    });
  });
}
export async function assertRecoveryRepository(
  root: string,
  budget: RecoveryBudget,
) {
  if ((await realpath(root)) !== root)
    throw new RecoveryError("RECOVERY_ENVIRONMENT_UNSUPPORTED");
  const actual = await probe(
    "git",
    ["rev-parse", "--show-toplevel"],
    root,
    budget,
  );
  const origin = await probe(
    "git",
    ["remote", "get-url", "origin"],
    root,
    budget,
  );
  if (
    actual !== root ||
    ![
      "https://github.com/aning0922/quiz-forge",
      "https://github.com/aning0922/quiz-forge.git",
    ].includes(origin)
  )
    throw new RecoveryError("RECOVERY_ENVIRONMENT_UNSUPPORTED");
}
/** No DB connection, private instance read, server startup or native runtime setup. */
export async function assertRecoveryEnvironment(
  root: string,
  budget: RecoveryBudget,
) {
  await assertRecoveryRepository(root, budget);
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  if (
    process.platform !== "darwin" ||
    process.arch !== "arm64" ||
    !(
      (major === 20 && minor >= 19) ||
      (major === 22 && minor >= 13) ||
      major > 22
    )
  )
    throw new RecoveryError("RECOVERY_ENVIRONMENT_UNSUPPORTED");
  for (const program of [
    "postgres",
    "pg_dump",
    "pg_restore",
    "pg_ctl",
    "initdb",
  ])
    if (
      !/\(PostgreSQL\) 18\.4(?: \(Homebrew\))?$/.test(
        await probe(
          `/opt/homebrew/bin/${program}`,
          ["--version"],
          root,
          budget,
        ),
      )
    )
      throw new RecoveryError("RECOVERY_ENVIRONMENT_UNSUPPORTED");
  checkRecoveryBudget(budget);
}
