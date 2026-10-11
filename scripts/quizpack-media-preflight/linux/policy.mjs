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
  const base = json(await readFile(resolve(DIR, "base.json")));
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
  for (const file of ["contracts.ts", "precheck.ts", "output.ts"]) {
    launcherInputs[`shared/${file}`] = hash(
      await readFile(resolve(DIR, "../shared", file)),
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
    dependencies,
    limits: LIMITS,
  };
  if (performance.now() >= deadline || signal?.aborted)
    throw new Error("PRECHECK_INTERRUPTED");
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
export function containerChecks(c, record) {
  const keys = [
    "id",
    "name",
    "image",
    "labels",
    "user",
    "environment",
    "entrypoint",
    "args",
    "mounts",
    "privileged",
    "readOnly",
    "capabilities",
    "noNewPrivileges",
    "seccomp",
    "network",
    "ipc",
    "pid",
    "cgroup",
    "memory",
    "swap",
    "cpu",
    "pids",
    "restart",
    "logging",
    "autoRemove",
    "binds",
    "devices",
    "volumes",
    "ports",
    "tmpfs",
    "health",
  ];
  const checks = Object.fromEntries(keys.map((k) => [k, false]));
  try {
    const h = c.host;
    Object.assign(checks, {
      id: /^[a-f0-9]{64}$/.test(c.id),
      name: c.name === `/${record.name}`,
      image: c.image === record.imageId,
      labels:
        c.labels["qf.run"] === record.runId &&
        c.labels["qf.nonce"] === record.nonce &&
        c.labels["qf.profile"] === record.profileId,
      user: c.user === "10001:10001",
      environment:
        JSON.stringify([...c.env].sort()) ===
        JSON.stringify(
          [
            "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "NODE_VERSION=20.20.1",
            "YARN_VERSION=1.22.22",
            "NODE_ENV=production",
            "UV_THREADPOOL_SIZE=4",
            "MALLOC_ARENA_MAX=2",
          ].sort(),
        ),
      entrypoint:
        JSON.stringify(c.entrypoint) === JSON.stringify([record.entrypoint]),
      args: JSON.stringify(c.cmd) === JSON.stringify(record.args),
      mounts: c.mounts.length === 0,
      privileged: !h.Privileged,
      readOnly: h.ReadonlyRootfs,
      capabilities:
        JSON.stringify(h.CapDrop) === '["ALL"]' && !h.CapAdd?.length,
      noNewPrivileges: h.SecurityOpt.includes("no-new-privileges=true"),
      seccomp: h.SecurityOpt.some(
        (v) =>
          v.startsWith("seccomp=") &&
          hash(JSON.stringify(JSON.parse(v.slice(8)))) === record.seccompSha256,
      ),
      network: h.NetworkMode === "none",
      ipc: h.IpcMode === "none",
      pid: h.PidMode === "",
      cgroup: h.CgroupnsMode === "private",
      memory: h.Memory === LIMITS.memory,
      swap: h.MemorySwap === LIMITS.memory,
      cpu: h.NanoCpus === LIMITS.nanoCpus,
      pids: h.PidsLimit === LIMITS.pids,
      restart: h.RestartPolicy.Name === "no",
      logging: h.LogConfig.Type === "none",
      autoRemove: !h.AutoRemove,
      binds: !h.Binds?.length,
      devices: !h.Devices?.length,
      volumes: !h.VolumesFrom?.length,
      ports: !(h.PortBindings && Object.keys(h.PortBindings).length),
      tmpfs: !(h.Tmpfs && Object.keys(h.Tmpfs).length),
      health: c.health?.Test?.[0] === "NONE",
    });
  } catch {
    /* malformed own inspect: conservative false fields, never raw values */
  }
  return checks;
}
export function matches(c, record) {
  return Object.values(containerChecks(c, record)).every((v) => v === true);
}
