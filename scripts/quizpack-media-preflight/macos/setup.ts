// Fixed offline preparation. It creates no capability and runs no worker/probe.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  existsSync,
  lstatSync,
  readdirSync,
  renameSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ensurePrivateDirectory, CONTROL_ROOT } from "./control";
import {
  RUNTIME_TARGET,
  REPO_ROOT,
  MAC_IDENTITY_HELPER,
  loadPolicy,
} from "./policy";
let temporary: string | null = null;
try {
  if (
    !RUNTIME_TARGET ||
    process.platform !== "darwin" ||
    process.arch !== "arm64"
  )
    throw new Error("UNSUPPORTED_PLATFORM");
  ensurePrivateDirectory(dirname(MAC_IDENTITY_HELPER));
  ensurePrivateDirectory(CONTROL_ROOT);
  if (readdirSync(CONTROL_ROOT).length) throw new Error("BUSY");
  temporary = mkdtempSync(join(dirname(MAC_IDENTITY_HELPER), ".prepare-"));
  chmodSync(temporary, 0o700);
  const next = join(temporary, "identity-helper");
  const result = spawnSync(
    "/usr/bin/cc",
    [
      "-std=c11",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-pthread",
      resolve(
        REPO_ROOT,
        "src/features/quizpack/server/media/internal/macos/identity-helper.c",
      ),
      "-o",
      next,
    ],
    {
      cwd: REPO_ROOT,
      env: { NODE_ENV: "production" },
      timeout: 10000,
      maxBuffer: 4096,
    },
  );
  if (result.status !== 0) throw new Error("ISOLATION_UNAVAILABLE");
  chmodSync(next, 0o700);
  if (existsSync(MAC_IDENTITY_HELPER)) {
    const s = lstatSync(MAC_IDENTITY_HELPER);
    if (
      !s.isFile() ||
      s.isSymbolicLink() ||
      s.uid !== process.getuid?.() ||
      s.nlink !== 1 ||
      (s.mode & 0o777) !== 0o700
    )
      throw new Error("ISOLATION_UNAVAILABLE");
  }
  renameSync(next, MAC_IDENTITY_HELPER);
  const policy = loadPolicy();
  process.stdout.write(
    JSON.stringify({
      outcome: "prepared",
      target: RUNTIME_TARGET,
      componentId: policy.componentId,
      profileId: policy.profileId,
    }) + "\n",
  );
} catch (error) {
  const code =
    error instanceof Error &&
    ["UNSUPPORTED_PLATFORM", "BUSY"].includes(error.message)
      ? error.message
      : "ISOLATION_UNAVAILABLE";
  process.stdout.write(JSON.stringify({ outcome: "failed", code }) + "\n");
  process.exitCode = 1;
} finally {
  if (temporary) {
    try {
      rmSync(temporary, { recursive: true, force: true });
    } catch {}
  }
}
