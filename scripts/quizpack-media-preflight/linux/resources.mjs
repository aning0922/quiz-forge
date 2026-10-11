// Trusted host harness only: sample the cgroup of an identity-matched own PID.
// Nothing here is mounted or delegated to a worker.
import { readFile } from "node:fs/promises";
import { docker, json } from "./common.mjs";
import { INSPECT, matches } from "./policy.mjs";
export async function measureOwnCgroup(record, deadline) {
  let peak = 0;
  let limits = null;
  let measured = false;
  for (let i = 0; i < 100 && performance.now() < deadline; i++) {
    const inspected = await docker(
      ["inspect", "--format", INSPECT, record.name],
      { deadline: deadline - 100, settleDeadline: deadline },
    );
    if (inspected.code !== 0 || inspected.reason || !inspected.settled) break;
    const c = json(inspected.stdout);
    if (!matches(c, record)) break;
    if (!c.state.Running || !c.state.Pid) {
      if (c.state.Status === "exited") break;
      await new Promise((ok) => setTimeout(ok, 10));
      continue;
    }
    const membership = await readFile(
      `/proc/${c.state.Pid}/cgroup`,
      "utf8",
    ).catch(() => "");
    if (membership.length > 1024) break;
    const path = membership
      .split("\n")
      .find((line) => line.startsWith("0::"))
      ?.slice(3);
    // Strict own ID/systemd scope or cgroupfs path, never an arbitrary host path.
    if (
      !path ||
      !new RegExp(
        `^/(?:system.slice/docker-${c.id}\\.scope|docker/${c.id})$`,
      ).test(path)
    )
      break;
    const root = `/sys/fs/cgroup${path}`;
    try {
      const values = await Promise.all(
        [
          "memory.peak",
          "memory.max",
          "memory.swap.max",
          "cpu.max",
          "pids.max",
        ].map((name) => readFile(`${root}/${name}`, "utf8")),
      );
      if (values.some((v) => v.length > 64)) break;
      const [p, m, s, cpu, pids] = values.map((v) => v.trim());
      const n = Number(p);
      if (!Number.isSafeInteger(n) || n < 1) break;
      peak = Math.max(peak, n);
      limits = { memory: Number(m), swap: Number(s), cpu, pids: Number(pids) };
      measured = true;
    } catch {
      break;
    }
    await new Promise((ok) => setTimeout(ok, 15));
  }
  return { measured, peakBytes: peak, limits };
}
