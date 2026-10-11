// Finite CI controls only: plain Node / tsx / node:test / tsx+node:test.
// Does not read FD paths, contents, environment values or control arbitrary commands.
import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
const root = fileURLToPath(new URL("../../../", import.meta.url));
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
let own;
let stage = "paths";
let commandExitCode = null;
try {
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
  const run = spawnSync(binary, ["fd-diagnostic"], {
    cwd: root,
    env: { NODE_ENV: "production" },
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 5000,
    maxBuffer: 2048,
  });
  commandExitCode = run.status;
  if (run.status !== 0) throw new Error("FD_CONTROL_FAILED");
  stage = "parse";
  const metadata = parse(run.stdout);
  process.stdout.write(
    `${JSON.stringify({ schema: "fd-host-control.v1", context, metadata })}\n`,
  );
  // Extra descriptors remain explicit evidence; this diagnostic is not an acceptance gate.
  if (!metadata.scanComplete) process.exitCode = 1;
} catch {
  process.stdout.write(
    `${JSON.stringify({ schema: "fd-host-control.v1", context, code: "FD_CONTROL_FAILED", stage, commandExitCode })}\n`,
  );
  process.exitCode = 1;
} finally {
  if (own) rmSync(own, { recursive: true });
}
