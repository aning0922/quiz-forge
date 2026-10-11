import { createHash } from "node:crypto";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
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
export function createArgs(record, entrypoint, args, seccompPath) {
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
    `--security-opt=seccomp=${seccompPath}`,
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
