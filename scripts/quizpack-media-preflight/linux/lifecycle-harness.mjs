import { watchOwnedClose } from "./owned-close.mjs";
import { spawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { controlFault } from "./control-fault.mjs";
import { executeSynthetic, verifyOwnStopped } from "./controller.mjs";
import {
  CACHE,
  setHarnessEndpoint,
  privateDir,
  writePrivate,
  docker,
  readPrivate,
  json,
  hash,
  command,
  safeMain,
} from "./common.mjs";
import { INSPECT, matches } from "./policy.mjs";

safeMain(async () => {
  const root = resolve(CACHE, randomUUID(), "lifecycle");
  await privateDir(root);
  const cases = [];
  const record = (id, passed, result) => {
    cases.push({ id, passed, result });
    process.stdout.write(
      JSON.stringify({
        case: id,
        passed,
        outcome: result?.outcome,
        stopped: result?.stopped,
        code: result?.code,
      }) + "\n",
    );
  };
  let recovery;
  let guardPreserved = false;
  let recoveryResult;
  const inFlight = await executeSynthetic({
    scenario: "hang",
    deadlineMonotonicMs: performance.now() + 1800,
    hooks: {
      startSpawn() {
        recovery = verifyOwnStopped().then(async (r) => {
          const raw = await readPrivate(
            resolve(CACHE, "control", "record.json"),
          );
          const guard = await readPrivate(resolve(CACHE, "control", "guard"));
          guardPreserved = raw.length > 0 && guard.length > 0;
          recoveryResult = r;
        });
      },
      async afterStart() {
        await recovery;
      },
    },
  });
  record(
    "start-inflight-recovery-refused",
    guardPreserved &&
      recoveryResult?.stopped === "unknown" &&
      inFlight.stopped === "confirmed",
    { ...inFlight, recoveryResult, guardPreserved },
  );
  // Real attach CLI SIGKILL; worker is independent and still must be kill/wait/inspected.
  let cliKilled = false;
  const lost = await executeSynthetic({
    scenario: "hang",
    hooks: {
      startSpawn(child) {
        setTimeout(() => {
          cliKilled = child.kill("SIGKILL");
        }, 250);
      },
    },
  });
  record(
    "attach-cli-loss",
    cliKilled && lost.outcome === "failed" && lost.stopped === "confirmed",
    lost,
  );
  for (const mode of [
    "lose-create-response",
    "lose-stop-response",
    "daemon-unavailable",
  ]) {
    const channel = await controlFault(mode);
    setHarnessEndpoint(channel.endpoint);
    let result;
    let runningObserved = false;
    try {
      result = await executeSynthetic({
        scenario: "hang",
        deadlineMonotonicMs: performance.now() + 5000,
        hooks: {
          diagnostic(event) {
            if (event.phase === "container-state" && event.running === true)
              runningObserved = true;
          },
          afterCreate() {
            if (mode === "daemon-unavailable") channel.arm();
          },
        },
      });
    } finally {
      setHarnessEndpoint(null);
      await channel.close();
    }
    const fired = channel.fired;
    const faultEvidence = channel.evidence();
    if (mode === "daemon-unavailable") {
      const raw = await readPrivate(resolve(CACHE, "control", "record.json"));
      const busy = await executeSynthetic();
      record(
        "daemon-unavailable-retained",
        fired &&
          result.code === "STOP_UNCONFIRMED" &&
          result.stopped === "unknown" &&
          busy.code === "BUSY",
        { ...result, recordRetained: raw.length > 0 },
      );
      const recovered = await verifyOwnStopped();
      record(
        "same-object-explicit-stop",
        recovered.stopped === "confirmed",
        recovered,
      );
    } else
      record(
        mode,
        fired &&
          result.outcome === "failed" &&
          result.stopped === "confirmed" &&
          (mode !== "lose-stop-response" ||
            (runningObserved &&
              faultEvidence.startRequests === 1 &&
              faultEvidence.killRequests === 1 &&
              faultEvidence.lostReplies === 1 &&
              faultEvidence.lastLostStatus === 204)),
        { ...result, runningObserved, faultEvidence },
      );
  }
  // Actual named object rename causes inspect mismatch; no fake inspect response.
  let renamed;
  let original;
  const mismatch = await executeSynthetic({
    scenario: "hang",
    hooks: {
      async afterCreate(r) {
        original = r.name;
        renamed = `${r.name}-own-mismatch`;
        const c = await docker(["inspect", "--format", INSPECT, r.name]);
        const v = json(c.stdout);
        if (!matches(v, r)) throw new Error("IDENTITY");
        const move = await docker(["rename", v.id, renamed]);
        if (move.code !== 0 || move.reason) throw new Error("RENAME");
      },
    },
  });
  record(
    "actual-identity-mismatch",
    mismatch.code === "STOP_UNCONFIRMED" && mismatch.stopped === "unknown",
    mismatch,
  );
  if (renamed) {
    const restored = await docker(["rename", renamed, original]);
    if (restored.code !== 0 || restored.reason)
      throw new Error("RESTORE_OWN_NAME");
  }
  const recovered = await verifyOwnStopped();
  record(
    "identity-restored-explicit-stop",
    recovered.stopped === "confirmed",
    recovered,
  );
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/quizpack-media-preflight/linux/crash-child.mjs",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
    },
  );
  let ownerClosed = false;
  let stdout = Buffer.alloc(0);
  let stdoutBytes = 0;
  let exceeded = false;
  let stderr = 0;
  const closeObserver = watchOwnedClose(child);
  const ready = await new Promise((ok) => {
    const timer = setTimeout(() => ok(null), 2500);
    child.on("error", () => {
      clearTimeout(timer);
      ok(null);
    });
    child.stdout.on("data", (b) => {
      stdoutBytes += b.length;
      if (exceeded || stdoutBytes > 2048) {
        exceeded = true;
        child.kill("SIGKILL");
        clearTimeout(timer);
        ok(null);
        return;
      }
      stdout = Buffer.concat([stdout, b]);
      try {
        const v = json(stdout);
        if (
          v.schema === "qf-own-create-closed.v1" &&
          v.ownerPid === child.pid &&
          v.createClosed === true
        ) {
          clearTimeout(timer);
          ok(v);
        }
      } catch {
        /* bounded partial protocol */
      }
    });
    child.stderr.on("data", (b) => {
      stderr += b.length;
      if (exceeded || stderr > 4096) {
        exceeded = true;
        child.kill("SIGKILL");
        clearTimeout(timer);
        ok(null);
      }
    });
  });
  const cleanupDeadline = performance.now() + 5000;
  child.kill("SIGKILL");
  const closed = await closeObserver.waitUntil(cleanupDeadline);
  ownerClosed = closed.closed;
  if (!ownerClosed) {
    closeObserver.releaseHandles();
    record("crashed-parent-close-budget", false, {
      outcome: "failed",
      code: "STOP_UNCONFIRMED",
      stopped: "unknown",
      ownerClosed: false,
      recordRetained: true,
    });
    await writePrivate(
      resolve(root, "summary.json"),
      JSON.stringify({
        schema: "qf-linux-lifecycle.v1",
        sourceCommit: process.env.GITHUB_SHA ?? "local",
        cases,
        accepted: false,
        residual: "fixed-control-record-and-guard-retained",
      }),
    );
    process.exitCode = 1;
    return;
  }
  if (!ready) throw new Error("CRASH_WINDOW_UNAVAILABLE");
  const persisted = await readPrivate(resolve(CACHE, "control", "record.json"));
  const own = json(persisted);
  const fresh = await command(process.execPath, [
    "--import",
    "tsx",
    "scripts/quizpack-media-preflight/linux/restart-child.mjs",
  ]);
  const freshResult = json(fresh.stdout);
  record(
    "crashed-parent-restart-blocked",
    ownerClosed &&
      own.runId === ready.runId &&
      own.ownerPid === child.pid &&
      fresh.code === 0 &&
      freshResult.code === "BUSY",
    { outcome: "failed", stopped: "unknown", code: freshResult.code },
  );
  const crashRecovered = await verifyOwnStopped({
    ownerClosed,
    createClosed: ready.createClosed,
    ownerPid: ready.ownerPid,
    recordSha256: hash(persisted),
  });
  record(
    "crashed-before-start-own-stop",
    crashRecovered.stopped === "confirmed",
    crashRecovered,
  );
  // New process must honor persisted unknown guard even if old owner's memory is gone.
  // Parent crash proof is added separately; it never silently clears this guard.
  let residual = false;
  try {
    await lstat(resolve(CACHE, "control", "record.json"));
    residual = true;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  record("lifecycle-control-clean", !residual, { residual });
  await writePrivate(
    resolve(root, "summary.json"),
    JSON.stringify({
      schema: "qf-linux-lifecycle.v1",
      sourceCommit: process.env.GITHUB_SHA ?? "local",
      cases,
      accepted: false,
    }),
  );
  if (cases.some((c) => !c.passed)) process.exitCode = 1;
});
