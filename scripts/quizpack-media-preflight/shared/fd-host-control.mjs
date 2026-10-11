// Finite CI controls only: plain Node / tsx / node:test / tsx+node:test.
// Does not read FD paths, contents, environment values or control arbitrary commands.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const args = process.argv.slice(2);
const launchMode = args[0] === "--async-probe" ? "async" : "sync";
const context = {
  node: process.version,
  platform: process.platform,
  tsxLoaderPresent: process.execArgv.some(
    (v) => v === "tsx" || v === "--import=tsx",
  ),
  testContextPresent: Object.hasOwn(process.env, "NODE_TEST_CONTEXT"),
  ipcChannelPresent: Boolean(process.channel),
};
function parse(bytes) {
  if (bytes.length > 2048) throw new Error("FD_CONTROL_FAILED");
  const text = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);
  const v = JSON.parse(text);
  if (
    JSON.stringify(v) !== text ||
    !v ||
    Object.keys(v).join() !==
      "schema,scanComplete,extraCount,truncated,descriptors" ||
    v.schema !== "posix-fd-diagnostic.v1" ||
    typeof v.scanComplete !== "boolean" ||
    !Number.isInteger(v.extraCount) ||
    v.extraCount < 0 ||
    v.extraCount > 65536 ||
    typeof v.truncated !== "boolean" ||
    !Array.isArray(v.descriptors) ||
    v.descriptors.length > 12
  )
    throw new Error("FD_CONTROL_FAILED");
  for (const d of v.descriptors) {
    if (
      !d ||
      Object.keys(d).join() !==
        "type,readMode,writeMode,closeOnExec,above255" ||
      ![
        "regular",
        "socket",
        "pipe",
        "character",
        "block",
        "directory",
        "other",
      ].includes(d.type) ||
      [d.readMode, d.writeMode, d.closeOnExec, d.above255].some(
        (x) => typeof x !== "boolean",
      )
    )
      throw new Error("FD_CONTROL_FAILED");
  }
  return v;
}
// Same fixed binary and stdio as sync. Success requires the actual close event;
// a bounded cleanup failure must never be reported as an empty-FD acceptance.
function runAsyncProbe(binary, options) {
  return new Promise((resolve) => {
    const deadline = performance.now() + 5000;
    let child;
    let finished = false;
    let stopping = false;
    let failureStage;
    let cleanupTimer;
    let outputBytes = 0;
    const stdout = [];
    function finish(status, closed) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(cleanupTimer);
      resolve({
        status,
        stdout: Buffer.concat(stdout),
        failureStage: closed ? failureStage : "probe-close-unconfirmed",
      });
    }
    function terminate(reason) {
      if (finished || stopping) return;
      failureStage ??= reason;
      stopping = true;
      cleanupTimer = setTimeout(() => {
        // Bound this diagnostic's own handles, while explicitly retaining the
        // fact that actual process/stdio closure has not been confirmed.
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.unref();
        finish(null, false);
      }, 1000);
      child.stdin?.destroy();
      try {
        // A failed spawn can expose no valid PID before its error/close events.
        if (Number.isInteger(child.pid) && child.pid > 0) child.kill("SIGKILL");
      } catch {
        // The cleanup deadline still applies if signaling failed.
      }
    }
    const timer = setTimeout(() => terminate("probe-timeout"), 5000);
    try {
      child = spawn(binary, ["fd-diagnostic"], options);
    } catch {
      failureStage = "probe-spawn";
      finish(null, true);
      return;
    }
    child.once("error", () => terminate("probe-spawn"));
    for (const stream of [child.stdin, child.stdout, child.stderr])
      stream?.once("error", () => terminate("probe-io"));
    const consume = (chunk, keep) => {
      if (finished || stopping) return;
      outputBytes += chunk.length;
      if (outputBytes > 2048) {
        terminate("probe-output-limit");
        return;
      }
      if (performance.now() >= deadline) {
        terminate("probe-timeout");
        return;
      }
      if (keep) stdout.push(chunk);
    };
    child.stdout?.on("data", (chunk) => consume(chunk, true));
    // Drain and count stderr, but never collect or expose its contents.
    child.stderr?.on("data", (chunk) => consume(chunk, false));
    child.once("close", (code, signal) => {
      if (performance.now() >= deadline) failureStage ??= "probe-timeout";
      if (code !== 0 || signal) failureStage ??= "probe-exit";
      finish(code, true);
    });
    if (!child.stdin || !child.stdout || !child.stderr) terminate("probe-io");
    else child.stdin.end();
  });
}
let own;
let stage = "arguments";
let commandExitCode = null;
try {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--async-probe"))
    throw new Error("FD_CONTROL_FAILED");
  stage = "paths";
  if (resolve(process.cwd()) !== resolve(root))
    throw new Error("FD_CONTROL_FAILED");
  const base = resolve(
    root,
    ".cache/quizpack-media-preflight/shared/fd-controls",
  );
  for (const suffix of [
    ".cache",
    ".cache/quizpack-media-preflight",
    ".cache/quizpack-media-preflight/shared",
    ".cache/quizpack-media-preflight/shared/fd-controls",
  ]) {
    const p = resolve(root, suffix);
    try {
      const st = lstatSync(p);
      if (
        !st.isDirectory() ||
        st.isSymbolicLink() ||
        st.uid !== process.getuid?.() ||
        (p === base ? (st.mode & 0o777) !== 0o700 : (st.mode & 0o022) !== 0)
      )
        throw new Error("FD_CONTROL_FAILED");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      mkdirSync(p, { mode: 0o700 });
    }
  }
  own = mkdtempSync(`${base}/control-`);
  chmodSync(own, 0o700);
  const binary = resolve(own, "probe");
  stage = "build";
  const build = spawnSync(
    "/usr/bin/cc",
    [
      "-std=c11",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-pthread",
      resolve(root, "scripts/quizpack-media-preflight/shared/posix-probe.c"),
      "-o",
      binary,
    ],
    {
      cwd: root,
      env: { NODE_ENV: "production", PATH: "/usr/bin:/bin" },
      stdio: "ignore",
      timeout: 10000,
    },
  );
  commandExitCode = build.status;
  if (build.status !== 0) throw new Error("FD_CONTROL_FAILED");
  chmodSync(binary, 0o700);
  stage = "probe";
  const probeOptions = {
    cwd: root,
    env: { NODE_ENV: "production" },
    stdio: ["pipe", "pipe", "pipe"],
  };
  const run =
    launchMode === "async"
      ? await runAsyncProbe(binary, probeOptions)
      : spawnSync(binary, ["fd-diagnostic"], {
          ...probeOptions,
          timeout: 5000,
          maxBuffer: 2048,
        });
  commandExitCode = run.status;
  if (run.failureStage) stage = run.failureStage;
  if (run.status !== 0 || run.failureStage)
    throw new Error("FD_CONTROL_FAILED");
  stage = "parse";
  const metadata = parse(run.stdout);
  process.stdout.write(
    `${JSON.stringify({ schema: "fd-host-control.v1", launchMode, context, metadata })}\n`,
  );
  // Extra descriptors remain explicit evidence; this diagnostic is not an acceptance gate.
  if (!metadata.scanComplete) process.exitCode = 1;
} catch {
  process.stdout.write(
    `${JSON.stringify({ schema: "fd-host-control.v1", launchMode, context, code: "FD_CONTROL_FAILED", stage, commandExitCode })}\n`,
  );
  process.exitCode = 1;
} finally {
  if (own) rmSync(own, { recursive: true });
}
