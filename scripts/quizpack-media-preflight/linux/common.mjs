import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, mkdir, lstat } from "node:fs/promises";
import { resolve, sep, dirname } from "node:path";
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
  const parent = await open(
    dirname(path),
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await parent.sync();
  } finally {
    await parent.close();
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
export { command } from "../../../src/features/quizpack/server/media/internal/linux/command.ts";
import { command } from "../../../src/features/quizpack/server/media/internal/linux/command.ts";
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
  "runtime-version",
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
