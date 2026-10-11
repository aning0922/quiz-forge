import { docker, json } from "./common.mjs";
export async function readRuntimeVersions({
  deadline = performance.now() + 5000,
  signal,
  controlCommand = docker,
} = {}) {
  const command = await controlCommand(
    ["version", "--format", "{{json .Server.Components}}"],
    { deadline: deadline - 100, settleDeadline: deadline, signal },
  );
  if (command.code !== 0 || command.reason || !command.settled)
    throw new Error("RUNTIME_VERSION_UNAVAILABLE");
  const components = json(command.stdout);
  if (!Array.isArray(components))
    throw new Error("RUNTIME_VERSION_UNAVAILABLE");
  const names = {
    Engine: "engine",
    containerd: "containerd",
    runc: "runc",
    "docker-init": "init",
  };
  const found = {};
  for (const c of components) {
    if (Object.hasOwn(names, c.Name)) {
      if (
        typeof c.Version !== "string" ||
        !/^[A-Za-z0-9._+-]{1,80}$/.test(c.Version) ||
        found[names[c.Name]]
      )
        throw new Error("RUNTIME_VERSION_UNAVAILABLE");
      found[names[c.Name]] = c.Version;
    }
  }
  if (
    ["engine", "containerd", "runc", "init"].some((k) => !found[k]) ||
    performance.now() >= deadline ||
    signal?.aborted
  )
    throw new Error("RUNTIME_VERSION_UNAVAILABLE");
  return Object.freeze({
    engine: found.engine,
    containerd: found.containerd,
    runc: found.runc,
    init: found.init,
  });
}
