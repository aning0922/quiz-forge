import { createLinuxFiles } from "../../../src/features/quizpack/server/media/internal/linux/files.mjs";
import { resolve } from "node:path";
export const ROOT = resolve(".");
export const DIR = resolve("scripts/quizpack-media-preflight/linux");
export const CACHE = resolve(".cache/quizpack-media-preflight/linux");
const files = createLinuxFiles({ checkoutRoot: ROOT, stateRoot: CACHE });
export const { hash, privateDir, writePrivate, readPrivate } = files;
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
