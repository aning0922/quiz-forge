import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { release, arch, platform } from "node:os";
import { CACHE, DIR, hash, docker, readPrivate, json } from "./common.mjs";
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
export async function loadPolicy() {
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
  const base = json(await readFile(resolve(DIR, "base.json")));
  if (
    image.schema !== "qf-linux-image.v1" ||
    image.base !== base.base ||
    image.platform !== "linux/amd64" ||
    !/^sha256:[a-f0-9]{64}$/.test(image.imageId)
  )
    throw new Error("IMAGE_IDENTITY");
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
  const inspect = await docker([
    "image",
    "inspect",
    "--format",
    "{{json .Id}}",
    image.imageId,
  ]);
  if (
    inspect.code !== 0 ||
    inspect.reason ||
    !inspect.settled ||
    json(inspect.stdout) !== image.imageId
  )
    throw new Error("MISSING_IMAGE");
  const info = await docker([
    "info",
    "--format",
    '{"id":{{json .ID}},"version":{{json .ServerVersion}},"os":{{json .OSType}},"arch":{{json .Architecture}},"security":{{json .SecurityOptions}},"memory":{{json .MemoryLimit}},"swap":{{json .SwapLimit}},"pids":{{json .PidsLimit}},"cpu":{{json .CPUCfsQuota}}}',
  ]);
  if (info.code !== 0 || info.reason || !info.settled)
    throw new Error("DAEMON_UNAVAILABLE");
  const daemon = json(info.stdout);
  if (
    daemon.os !== "linux" ||
    !["x86_64", "amd64"].includes(daemon.arch) ||
    !daemon.id ||
    !daemon.security.some((v) => v.startsWith("name=seccomp")) ||
    !daemon.memory ||
    !daemon.swap ||
    !daemon.pids ||
    !daemon.cpu
  )
    throw new Error("CAPABILITY_UNAVAILABLE");
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
    JSON.stringify(json(await readFile(resolve(DIR, "seccomp.json")))),
  );
  const launcherInputs = {};
  for (const file of ["common.mjs", "controller.mjs", "policy.mjs"]) {
    launcherInputs[file] = hash(await readFile(resolve(DIR, file)));
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
    dependencies,
    limits: LIMITS,
  };
  return { image, binding, profileId: hash(JSON.stringify(binding)) };
}
export function createArgs(record, entrypoint, args) {
  return [
    "create",
    "--pull=never",
    "--platform=linux/amd64",
    "--name",
    record.name,
    "--label",
    `qf.run=${record.runId}`,
    "--label",
    `qf.nonce=${record.nonce}`,
    "--label",
    `qf.profile=${record.profileId}`,
    "--user=10001:10001",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true",
    `--security-opt=seccomp=${resolve(DIR, "seccomp.json")}`,
    "--network=none",
    "--ipc=none",
    "--cgroupns=private",
    "--restart=no",
    "--no-healthcheck",
    "--log-driver=none",
    "--memory=512m",
    "--memory-swap=512m",
    "--cpus=1",
    "--pids-limit=64",
    "--ulimit=core=0:0",
    "--ulimit=nofile=64:64",
    "--stop-signal=SIGKILL",
    "--stop-timeout=0",
    "--interactive",
    "--entrypoint",
    entrypoint,
    record.imageId,
    ...args,
  ];
}
export const INSPECT =
  '{ "id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"labels":{{json .Config.Labels}},"user":{{json .Config.User}},"entrypoint":{{json .Config.Entrypoint}},"cmd":{{json .Config.Cmd}},"env":{{json .Config.Env}},"health":{{json .Config.Healthcheck}},"mounts":{{json .Mounts}},"host":{{json .HostConfig}},"state":{{json .State}} }';
export function matches(container, record) {
  const h = container.host;
  return (
    /^[a-f0-9]{64}$/.test(container.id) &&
    container.name === `/${record.name}` &&
    container.image === record.imageId &&
    container.labels["qf.run"] === record.runId &&
    container.labels["qf.nonce"] === record.nonce &&
    container.labels["qf.profile"] === record.profileId &&
    container.user === "10001:10001" &&
    JSON.stringify([...container.env].sort()) ===
      JSON.stringify(
        [
          "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          "NODE_VERSION=20.20.1",
          "YARN_VERSION=1.22.22",
          "NODE_ENV=production",
          "UV_THREADPOOL_SIZE=4",
          "MALLOC_ARENA_MAX=2",
        ].sort(),
      ) &&
    JSON.stringify(container.entrypoint) ===
      JSON.stringify([record.entrypoint]) &&
    JSON.stringify(container.cmd) === JSON.stringify(record.args) &&
    container.mounts.length === 0 &&
    !h.Privileged &&
    h.ReadonlyRootfs &&
    JSON.stringify(h.CapDrop) === '["ALL"]' &&
    !h.CapAdd?.length &&
    h.SecurityOpt.includes("no-new-privileges=true") &&
    h.SecurityOpt.some(
      (v) =>
        v.startsWith("seccomp=") &&
        hash(JSON.stringify(JSON.parse(v.slice(8)))) === record.seccompSha256,
    ) &&
    h.NetworkMode === "none" &&
    h.IpcMode === "none" &&
    h.PidMode === "" &&
    h.CgroupnsMode === "private" &&
    h.Memory === LIMITS.memory &&
    h.MemorySwap === LIMITS.memory &&
    h.NanoCpus === LIMITS.nanoCpus &&
    h.PidsLimit === LIMITS.pids &&
    h.RestartPolicy.Name === "no" &&
    h.LogConfig.Type === "none" &&
    !h.AutoRemove &&
    !h.Binds?.length &&
    !h.Devices?.length &&
    !h.VolumesFrom?.length &&
    !(h.PortBindings && Object.keys(h.PortBindings).length) &&
    !(h.Tmpfs && Object.keys(h.Tmpfs).length) &&
    container.health?.Test?.[0] === "NONE"
  );
}
