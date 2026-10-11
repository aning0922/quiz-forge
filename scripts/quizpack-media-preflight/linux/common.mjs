import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, mkdir, lstat } from "node:fs/promises";
import { resolve, sep } from "node:path";
export const ROOT = resolve(".");
export const DIR = resolve("scripts/quizpack-media-preflight/linux");
export const CACHE = resolve(".cache/quizpack-media-preflight/linux");
export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function privateDir(path) {
  if (!path.startsWith(ROOT + sep)) throw new Error("PRIVATE_PATH");
  const parts = path.slice(ROOT.length + 1).split(sep);
  let next = ROOT;
  for (const part of parts) {
    next = resolve(next, part);
    try {
      await mkdir(next, { mode: 0o700 });
    } catch (e) {
      if (e.code !== "EEXIST") throw new Error("PRIVATE_DIRECTORY");
    }
    const s = await lstat(next);
    if (
      !s.isDirectory() ||
      s.isSymbolicLink() ||
      s.uid !== process.getuid() ||
      (next.startsWith(CACHE) ? (s.mode & 0o077) !== 0 : (s.mode & 0o022) !== 0)
    )
      throw new Error("PRIVATE_DIRECTORY");
  }
}
export async function writePrivate(path, bytes) {
  const f = await open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await f.writeFile(bytes);
    await f.sync();
  } finally {
    await f.close();
  }
}
export async function readPrivate(path, limit = 16384) {
  const f = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const s = await f.stat();
    if (
      !s.isFile() ||
      s.uid !== process.getuid() ||
      (s.mode & 0o077) !== 0 ||
      s.size > limit
    )
      throw new Error("PRIVATE_FILE");
    const buf = Buffer.alloc(limit + 1);
    const { bytesRead } = await f.read(buf, 0, buf.length, 0);
    if (bytesRead > limit) throw new Error("PRIVATE_FILE");
    return buf.subarray(0, bytesRead);
  } finally {
    await f.close();
  }
}
// Bounded IO; close (not exit or kill success) is the local stdio barrier.
export function command(
  binary,
  args,
  {
    deadline = performance.now() + 5000,
    input,
    settleDeadline = deadline + 250,
    stdoutLimit = 16384,
    stderrLimit = 4096,
    signal,
    onSpawn,
    env,
  } = {},
) {
  return new Promise((resolvePromise) => {
    let child;
    let reason;
    let out = [];
    let outBytes = 0;
    let errBytes = 0;
    let stderrCategory = "empty";
    let settled = false;
    const stop = (why) => {
      reason ??= why;
      if (child) {
        child.stdin?.destroy();
        child.kill("SIGKILL");
      }
    };
    const cancel = () => stop("CANCELLED");
    const hardTimer = setTimeout(
      () => {
        reason ??= "DEADLINE_EXCEEDED";
        stop(reason);
        child?.stdout?.destroy();
        child?.stderr?.destroy();
        finish(null, null, false);
      },
      Math.max(0, settleDeadline - performance.now()),
    );
    const timer = setTimeout(
      () => stop("DEADLINE_EXCEEDED"),
      Math.max(0, deadline - performance.now()),
    );
    const finish = (code, signalName, closed = true) => {
      if (settled) return;
      settled = true;
      reason ??= signal?.aborted
        ? "CANCELLED"
        : performance.now() >= deadline
          ? "DEADLINE_EXCEEDED"
          : undefined;
      clearTimeout(timer);
      clearTimeout(hardTimer);
      signal?.removeEventListener("abort", cancel);
      resolvePromise({
        code,
        signal: signalName,
        reason,
        stdout: Buffer.concat(out),
        stdoutBytes: outBytes,
        stderrBytes: errBytes,
        stderrCategory,
        settled: closed,
      });
    };
    if (performance.now() >= deadline || signal?.aborted) {
      reason = signal?.aborted ? "CANCELLED" : "DEADLINE_EXCEEDED";
      finish(null, null);
      return;
    }
    try {
      child = spawn(binary, args, {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: env ?? { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
      });
    } catch {
      reason = "WORKER_FAILED";
      finish(null, null);
      return;
    }
    onSpawn?.(child);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    child.on("error", () => {
      reason ??= "WORKER_FAILED";
    });
    child.stdin.on("error", () => {
      reason ??= "WORKER_FAILED";
    });
    child.stdout.on("error", () => stop("WORKER_FAILED"));
    child.stderr.on("error", () => stop("WORKER_FAILED"));
    child.stdout.on("data", (chunk) => {
      outBytes += chunk.length;
      if (outBytes > stdoutLimit) stop("OUTPUT_INVALID");
      else out.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      const category =
        /uv_thread_create|pthread_create|ThreadPoolTaskRunner/.test(text)
          ? "thread-create-failed"
          : /EACCES|Permission denied/.test(text)
            ? "permission-denied"
            : /EPERM|Operation not permitted/.test(text)
              ? "operation-not-permitted"
              : /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find module/.test(
                    text,
                  )
                ? "module-unavailable"
                : /Assertion|assertion|Aborted/.test(text)
                  ? "runtime-abort"
                  : "unclassified";
      if (stderrCategory === "empty" || stderrCategory === "unclassified")
        stderrCategory = category;
      errBytes += chunk.length;
      if (errBytes > stderrLimit) stop("OUTPUT_INVALID");
    });
    child.once("close", (code, signalName) => finish(code, signalName));
    // Backpressure stays bounded by one private input snapshot, never another read.
    child.stdin.end(input);
  });
}
let harnessEndpoint = null;
// Test-only switch, normal public API cannot set it. Only this fixed private
// Unix socket is allowed; normal transport remains the frozen local daemon.
export function setHarnessEndpoint(endpoint) {
  if (
    endpoint !== null &&
    endpoint !== `unix://${resolve(CACHE, "fault-channel", "socket")}`
  )
    throw new Error("FAULT_ENDPOINT");
  harnessEndpoint = endpoint;
}
export async function docker(args, opts = {}) {
  return command(
    "/usr/bin/docker",
    [
      "--config",
      resolve(CACHE, "docker-config"),
      "--host",
      harnessEndpoint ?? "unix:///var/run/docker.sock",
      ...args,
    ],
    opts,
  );
}
export function json(bytes) {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
const SAFE_STAGES = new Set([
  "platform",
  "paths",
  "base-metadata",
  "inputs",
  "native-compile",
  "base-pull",
  "image-build",
  "image-inspect",
  "image-record",
  "native-identity",
  "dependencies-record",
]);
export function safeMain(fn, stageFn = () => null) {
  fn().catch(() => {
    process.stdout.write(
      JSON.stringify({
        outcome: "failed",
        code: "ISOLATION_UNAVAILABLE",
        stage: SAFE_STAGES.has(stageFn()) ? stageFn() : null,
      }) + "\n",
    );
    process.exitCode = 1;
  });
}
