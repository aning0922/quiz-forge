// Closed synthetic subprocess for the parent-crash window. No arbitrary argv/env.
import { performance } from "node:perf_hooks";
import { runHarnessCase } from "./launcher";
import { readControlForHarness } from "./control";
const pending = runHarnessCase(
  { kind: "fault", scenario: "parent-crash" },
  {
    signal: new AbortController().signal,
    deadlineMonotonicMs: performance.now() + 5000,
  },
);
const check = setInterval(() => {
  try {
    const r = readControlForHarness();
    if (r.ownerPid === process.pid && r.phase === "spawned" && r.workerStart) {
      clearInterval(check);
      process.stdout.write(
        JSON.stringify({
          schema: "mac-parent-crash-ready.v1",
          runId: r.runId,
          profileId: r.profileId,
          ownerPid: r.ownerPid,
          workerPid: r.pid,
          workerStart: r.workerStart,
        }) + "\n",
      );
    }
  } catch {}
}, 10);
pending.then(
  () => clearInterval(check),
  () => {
    clearInterval(check);
    process.exitCode = 1;
  },
);
