import { readRuntimeVersions } from "./runtime.mjs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { release, arch, platform } from "node:os";
import {
  CACHE,
  DIR,
  CORE_DIR,
  hash,
  docker,
  readPrivate,
  json,
} from "./common.mjs";
export const LIMITS = Object.freeze({
  bytes: 8388608,
  dimension: 8192,
  pixels: 16000000,
  executionMs: 5000,
  cleanupMs: 5000,
  stdout: 2048,
  stderr: 4096,
  memory: 536870912,
  nanoCpus: 1000000000,
  pids: 64,
});
export async function loadPolicy({
  deadline = performance.now() + 5000,
  signal,
  onDiagnostic,
  controlCommand = docker,
} = {}) {
  const options = {
    deadline: deadline - 100,
    settleDeadline: deadline,
    signal,
  };
  if (performance.now() >= deadline || signal?.aborted)
    throw new Error("PRECHECK_INTERRUPTED");
  if (platform() !== "linux" || arch() !== "x64")
    throw new Error("UNSUPPORTED_PLATFORM");
  if (
    [
      "DOCKER_HOST",
      "DOCKER_CONTEXT",
      "DOCKER_TLS_VERIFY",
      "DOCKER_CERT_PATH",
    ].some((k) => process.env[k])
  )
    throw new Error("ENDPOINT_OVERRIDE");
  const image = json(await readPrivate(resolve(CACHE, "image.json")));
  const base = json(await readFile(resolve(CORE_DIR, "base.json")));
  if (
    image.schema !== "qf-linux-image.v1" ||
    image.base !== base.base ||
    image.platform !== "linux/amd64" ||
    !/^sha256:[a-f0-9]{64}$/.test(image.imageId)
  )
    throw new Error("IMAGE_IDENTITY");
  if (
    hash(await readFile(resolve(DIR, "../shared/posix-probe.c"))) !==
    image.inputs["posix-probe.c"]
  )
    throw new Error("SHARED_PROBE_CHANGED");
  const sourceHash = hash(
    await readFile(resolve("src/features/quizpack/v1/media-worker.mjs")),
  );
  if (sourceHash !== image.workerSha256) throw new Error("WORKER_CHANGED");
  for (const [name, path] of [
    ["Dockerfile", "Dockerfile"],
    ["package.json", "worker/package.json"],
    ["package-lock.json", "worker/package-lock.json"],
    ["identity.mjs", "worker/identity.mjs"],
    ["fault-worker.mjs", "worker/fault-worker.mjs"],
    ["native-probe.c", "native-probe.c"],
  ]) {
    if (hash(await readFile(resolve(DIR, path))) !== image.inputs[name])
      throw new Error("BUILD_INPUT_CHANGED");
  }
  const inspect = await controlCommand(
    ["image", "inspect", "--format", "{{json .Id}}", image.imageId],
    options,
  );
  onDiagnostic?.({
    phase: "policy-image-inspect",
    exitCode: inspect.code,
    settled: inspect.settled,
    reason: inspect.reason ?? null,
  });
  if (
    inspect.code !== 0 ||
    inspect.reason ||
    !inspect.settled ||
    json(inspect.stdout) !== image.imageId
  )
    throw new Error("MISSING_IMAGE");
  const info = await controlCommand(
    [
      "info",
      "--format",
      '{"id":{{json .ID}},"version":{{json .ServerVersion}},"os":{{json .OSType}},"arch":{{json .Architecture}},"security":{{json .SecurityOptions}},"memory":{{json .MemoryLimit}},"swap":{{json .SwapLimit}},"pids":{{json .PidsLimit}},"cpu":{{json .CPUCfsQuota}}}',
    ],
    options,
  );
  onDiagnostic?.({
    phase: "policy-daemon-info",
    exitCode: info.code,
    settled: info.settled,
    reason: info.reason ?? null,
  });
  if (info.code !== 0 || info.reason || !info.settled)
    throw new Error("DAEMON_UNAVAILABLE");
  const daemon = json(info.stdout);
  const capabilities = {
    os: daemon.os === "linux",
    arch: ["x86_64", "amd64"].includes(daemon.arch),
    identity: typeof daemon.id === "string" && daemon.id.length > 0,
    seccomp:
      Array.isArray(daemon.security) &&
      daemon.security.some((v) => v.startsWith("name=seccomp")),
    memory: daemon.memory === true,
    swap: daemon.swap === true,
    pids: daemon.pids === true,
    cpu: daemon.cpu === true,
  };
  onDiagnostic?.({ phase: "policy-capabilities", checks: capabilities });
  if (!Object.values(capabilities).every((v) => v === true))
    throw new Error("CAPABILITY_UNAVAILABLE");
  const runtimeVersions = await readRuntimeVersions({
    deadline,
    signal,
    controlCommand,
  });
  const expectedVersions = image.runtimeVersions;
  if (
    !expectedVersions ||
    ["engine", "containerd", "runc", "init"].some(
      (k) => runtimeVersions[k] !== expectedVersions[k],
    )
  )
    throw new Error("RUNTIME_VERSION_CHANGED");
  onDiagnostic?.({ phase: "policy-runtime-versions", matched: true });
  let dependencies = null;
  try {
    dependencies = json(await readPrivate(resolve(CACHE, "dependencies.json")));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (
    dependencies &&
    (dependencies.node !== "20.20.1" ||
      dependencies.sharp !== "0.35.5" ||
      typeof dependencies.vips !== "string" ||
      dependencies.workerSha256 !== image.workerSha256)
  )
    throw new Error("DEPENDENCIES_CHANGED");
  const seccompSha256 = hash(
    JSON.stringify(json(await readFile(resolve(CORE_DIR, "seccomp.json")))),
  );
  const launcherInputs = {};
  for (const file of [
    "common.mjs",
    "controller.mjs",
    "policy.mjs",
    "runtime.mjs",
  ]) {
    launcherInputs[file] = hash(await readFile(resolve(DIR, file)));
  }
  for (const file of ["contracts.ts", "precheck.ts", "output.ts"]) {
    launcherInputs[`shared/${file}`] = hash(
      await readFile(resolve(DIR, "../shared", file)),
    );
  }
  for (const file of [
    "contracts.ts",
    "internal/shared/precheck.ts",
    "internal/shared/output.ts",
    "internal/linux/command.ts",
    "internal/linux/diagnostic.ts",
    "internal/linux/execute.mjs",
    "internal/linux/container-policy.mjs",
    "internal/linux/files.mjs",
    "operation-context.ts",
  ]) {
    launcherInputs[`production/${file}`] = hash(
      await readFile(resolve("src/features/quizpack/server/media", file)),
    );
  }
  const binding = {
    schema: "qf-linux-policy.v1",
    kernel: release(),
    arch: arch(),
    imageId: image.imageId,
    base: image.base,
    buildInputsHash: image.buildInputsHash,
    workerSha256: image.workerSha256,
    seccompSha256,
    launcherPolicySha256: hash(JSON.stringify(launcherInputs)),
    daemon,
    runtimeVersions,
    dependencies,
    limits: LIMITS,
  };
  if (performance.now() >= deadline || signal?.aborted)
    throw new Error("PRECHECK_INTERRUPTED");
  return { image, binding, profileId: hash(JSON.stringify(binding)) };
}
export {
  INSPECT,
  containerChecks,
  matches,
} from "../../../src/features/quizpack/server/media/internal/linux/container-policy.mjs";
import { createArgs as createCoreArgs } from "../../../src/features/quizpack/server/media/internal/linux/container-policy.mjs";
export function createArgs(record, entrypoint, args) {
  return createCoreArgs(
    record,
    entrypoint,
    args,
    resolve(CORE_DIR, "seccomp.json"),
  );
}
