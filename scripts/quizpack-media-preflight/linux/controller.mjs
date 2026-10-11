import { classifySystemError } from "./diagnostic.mjs";
import { parseWorkerOutput } from "../shared/output.ts";
import { precheckImage } from "../shared/precheck.ts";
import { platform, arch } from "node:os";
import { randomUUID, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { unlink, lstat } from "node:fs/promises";
import {
  CACHE,
  hash,
  privateDir,
  writePrivate,
  readPrivate,
  docker,
  json,
} from "./common.mjs";
import {
  LIMITS,
  INSPECT,
  containerChecks,
  createArgs,
  loadPolicy,
} from "./policy.mjs";

const CONTROL = resolve(CACHE, "control");
const RECORD = resolve(CONTROL, "record.json");
const GUARD = resolve(CONTROL, "guard");
const localBarriers = new Set();
const activeExecutions = new Set();
const controlStates = new Map();
let recoveryActive = false;
async function ownedDocker(record, args, options) {
  const state = controlStates.get(record.runId) ?? {
    pending: 0,
    unsettled: false,
    originKnown: false,
  };
  controlStates.set(record.runId, state);
  state.pending++;
  localBarriers.delete(record.runId);
  try {
    const result = await docker(args, options);
    state.pending--;
    state.unsettled ||= !result.settled;
    if (!state.pending && !state.unsettled && state.originKnown)
      localBarriers.add(record.runId);
    return result;
  } catch (e) {
    state.pending--;
    state.unsettled = true;
    localBarriers.delete(record.runId);
    throw e;
  }
}
const fail = (runId, profileId, code, stopped) => ({
  outcome: "failed",
  runId,
  profileId,
  code,
  stopped,
});
const NORMAL = {
  entrypoint: "/usr/local/bin/node",
  args: ["/worker/media-worker.mjs", "8388608", "8192", "16000000"],
};
const FAULTS = new Set([
  "stdout",
  "stderr",
  "bad-json",
  "multi-json",
  "invalid-utf8",
  "nonzero",
  "crash",
  "oom",
  "hang",
  "success-hang",
  "backpressure",
]);
export function fixedScenario(scenario, syntheticRoot) {
  if (scenario === "normal") return NORMAL;
  if (["posix-process", "posix-fd"].includes(scenario))
    return { entrypoint: "/worker/posix-probe", args: [scenario.slice(6)] };
  if (scenario === "posix-network")
    return {
      entrypoint: "/worker/posix-probe",
      args: ["network", "1", "/qf-synthetic.sock"],
    };
  if (scenario === "identity")
    return {
      entrypoint: "/usr/local/bin/node",
      args: ["/worker/identity.mjs"],
    };
  if (
    scenario === "native" &&
    syntheticRoot?.startsWith(CACHE + "/") &&
    !syntheticRoot.includes("..")
  )
    return { entrypoint: "/worker/native-probe", args: [syntheticRoot] };
  if (FAULTS.has(scenario))
    return {
      entrypoint: "/usr/local/bin/node",
      args: ["/worker/fault-worker.mjs", scenario],
    };
  throw new Error("SCENARIO_INVALID");
}
async function inspect(record, deadline, onDiagnostic) {
  const r = await ownedDocker(
    record,
    ["inspect", "--format", INSPECT, record.name],
    {
      deadline: deadline - 100,
      settleDeadline: deadline,
    },
  );
  onDiagnostic?.({
    phase: "container-inspect-command",
    exitCode: r.code,
    settled: r.settled,
    reason: r.reason ?? null,
  });
  if (r.code !== 0 || r.reason || !r.settled) return null;
  try {
    const value = json(r.stdout);
    const checks = containerChecks(value, record);
    onDiagnostic?.({ phase: "container-checks", checks });
    const classified = classifySystemError(value.state?.Error);
    onDiagnostic?.({
      phase: "container-state",
      running: value.state?.Running === true,
      status: [
        "created",
        "exited",
        "running",
        "paused",
        "dead",
        "restarting",
        "removing",
      ].includes(value.state?.Status)
        ? value.state.Status
        : "unknown",
      exitCode: Number.isSafeInteger(value.state?.ExitCode)
        ? value.state.ExitCode
        : null,
      errorCategory: classified.category,
      knownSyscall: classified.knownSyscall,
      errno: classified.errno,
      fifoOperation: classified.fifoOperation,
      reference: classified.reference,
    });
    return Object.values(checks).every((v) => v === true) ? value : null;
  } catch {
    return null;
  }
}
async function removeConfirmed(record, container, deadline) {
  // Exact ID after identity verification. No force, volumes, broad filters, or --rm.
  const r = await ownedDocker(record, ["rm", container.id], {
    deadline: deadline - 100,
    settleDeadline: deadline,
  });
  if (r.code !== 0 || r.reason || !r.settled) return false;
  if (r.stdout.toString("utf8").trim() !== container.id) return false;
  // Fixed private identities must still be our bytes before local deletion.
  if (hash(await readPrivate(RECORD)) !== record.recordHash) return false;
  if ((await readPrivate(GUARD, 128)).toString() !== record.runId) return false;
  await unlink(RECORD);
  await unlink(GUARD);
  localBarriers.delete(record.runId);
  controlStates.delete(record.runId);
  return true;
}
// Internal closed synthetic harness. Normal entry below always runs shared precheck.
// No P1 or business entry imports this candidate.
export async function executeSynthetic({
  scenario = "normal",
  bytes = Buffer.alloc(0),
  expected,
  signal,
  deadlineMonotonicMs = performance.now() + 5000,
  syntheticRoot,
  hooks = {},
  preallocatedRunId,
} = {}) {
  const runId = preallocatedRunId ?? randomUUID(); // before any await/platform command
  const deadline = Math.min(
    deadlineMonotonicMs,
    performance.now() + LIMITS.executionMs,
  );
  const snapshot = Buffer.from(bytes);
  let profileId = null;
  let record;
  let guardOwned = false;
  let issued = false;
  let container;
  let output;
  let reason;
  const interrupt = () =>
    signal?.aborted
      ? "CANCELLED"
      : performance.now() >= deadline
        ? "DEADLINE_EXCEEDED"
        : null;
  if (recoveryActive) return fail(runId, null, "BUSY", "not-started");
  if (snapshot.length > LIMITS.bytes)
    return fail(runId, null, "INPUT_LIMIT", "not-started");
  if (interrupt()) return fail(runId, null, interrupt(), "not-started");
  activeExecutions.add(runId);
  try {
    await privateDir(CONTROL);
    // Never steal stale guards. Incomplete/unknown records block restart.
    try {
      await lstat(RECORD);
      return fail(runId, null, "BUSY", "not-started");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    try {
      await writePrivate(GUARD, runId);
      guardOwned = true;
    } catch {
      return fail(runId, null, "BUSY", "not-started");
    }
    const policy = await loadPolicy({
      deadline,
      signal,
      onDiagnostic: hooks.diagnostic,
    });
    profileId = policy.profileId;
    if (scenario !== "identity" && !policy.binding.dependencies)
      throw new Error("DEPENDENCIES_UNVERIFIED");
    const spec = fixedScenario(scenario, syntheticRoot);
    record = {
      schema: "qf-linux-run.v1",
      runId,
      ownerPid: process.pid,
      nonce: randomBytes(32).toString("hex"),
      name: `qf-media-${runId}`,
      imageId: policy.image.imageId,
      profileId,
      seccompSha256: policy.binding.seccompSha256,
      daemonId: policy.binding.daemon.id,
      ...spec,
    };
    const persisted = JSON.stringify(record);
    await writePrivate(RECORD, persisted);
    record.recordHash = hash(persisted);
    if (interrupt()) {
      reason = interrupt();
    } else {
      issued = true;
      controlStates.set(runId, {
        pending: 0,
        unsettled: false,
        originKnown: true,
      });
      const create = await ownedDocker(
        record,
        createArgs(record, spec.entrypoint, spec.args),
        {
          deadline,
          settleDeadline: deadline + LIMITS.cleanupMs,
          signal,
          onSpawn: hooks.createSpawn,
        },
      );
      hooks.diagnostic?.({
        phase: "create",
        exitCode: create.code,
        settled: create.settled,
        reason: create.reason ?? null,
        stderrCategory: create.stderrCategory,
        knownSyscall: create.stderrSyscall,
        ...create.stderrDetails,
      });
      await hooks.afterCreate?.(record, create);
      if (!create.settled) {
        return fail(runId, profileId, "STOP_UNCONFIRMED", "unknown");
      }
      container = await inspect(record, deadline, hooks.diagnostic);
      if (!container)
        return fail(runId, profileId, "STOP_UNCONFIRMED", "unknown");
      // A lost create response may be recovered only by exact inspected identity.
      if (create.reason || create.code !== 0)
        reason = create.reason ?? "WORKER_FAILED";
      reason ??= interrupt();
      if (!reason) {
        output = await ownedDocker(
          record,
          ["start", "--attach", "--interactive", container.id],
          {
            deadline,
            settleDeadline: deadline + LIMITS.cleanupMs,
            signal,
            input: snapshot,
            stdoutLimit: LIMITS.stdout,
            stderrLimit: LIMITS.stderr,
            onSpawn: hooks.startSpawn,
          },
        );
        hooks.diagnostic?.({
          phase: "start-attach",
          exitCode: output.code,
          settled: output.settled,
          reason: output.reason ?? null,
          stderrCategory: output.stderrCategory,
          knownSyscall: output.stderrSyscall,
          ...output.stderrDetails,
        });
        await hooks.afterStart?.(record, output);
        reason =
          output.reason ??
          interrupt() ??
          (output.code !== 0 ? "WORKER_FAILED" : null);
      }
    }
    const cleanupDeadline =
      Math.min(performance.now(), deadline) + LIMITS.cleanupMs;
    // One stop path for decode, failure, cancellation. Inspect/wait are authoritative.
    container = await inspect(record, cleanupDeadline, hooks.diagnostic);
    if (!container)
      return fail(runId, profileId, "STOP_UNCONFIRMED", "unknown");
    if (container.state.Running || container.state.Status === "created") {
      if (container.state.Running) {
        const killed = await ownedDocker(
          record,
          ["kill", "--signal=SIGKILL", container.id],
          { deadline: cleanupDeadline - 100, settleDeadline: cleanupDeadline },
        );
        if (!killed.settled) {
          localBarriers.delete(runId);
          return fail(runId, profileId, "STOP_UNCONFIRMED", "unknown");
        }
      }
    }
    const waited =
      container.state.Status === "created"
        ? null
        : await ownedDocker(record, ["wait", container.id], {
            deadline: cleanupDeadline - 100,
            settleDeadline: cleanupDeadline,
          });
    const final = await inspect(record, cleanupDeadline, hooks.diagnostic);
    const stopped =
      final &&
      !final.state.Running &&
      !final.state.Restarting &&
      ["exited", "created"].includes(final.state.Status);
    const waitOk =
      final?.state.Status === "created" ||
      (waited?.code === 0 &&
        !waited.reason &&
        waited.settled &&
        /^\d+\s*$/.test(waited.stdout.toString("utf8")) &&
        Number(waited.stdout.toString()) === final?.state.ExitCode);
    if (
      !stopped ||
      !waitOk ||
      output?.settled === false ||
      performance.now() >= cleanupDeadline
    )
      return fail(runId, profileId, "STOP_UNCONFIRMED", "unknown");
    const evidence = {
      containerStopped: true,
      stdioSettled: output?.settled ?? true,
      containerId: final.id,
      state: final.state.Status,
      exitCode: final.state.ExitCode,
      oomKilled: final.state.OOMKilled,
      identityMatched: true,
    };
    // Recheck deadline before interpreting any apparent success; cleanup can't extend it.
    reason ??= interrupt();
    const removed = await removeConfirmed(record, final, cleanupDeadline);
    if (!removed)
      return {
        ...fail(runId, profileId, "STOP_UNCONFIRMED", "unknown"),
        evidence,
      };
    if (reason)
      return { ...fail(runId, profileId, reason, "confirmed"), evidence };
    if (scenario === "normal") {
      if (final.state.ExitCode !== 0)
        return {
          ...fail(runId, profileId, "WORKER_FAILED", "confirmed"),
          evidence,
        };
      const facts = parseWorkerOutput(output.stdout, expected);
      if (!facts.ok)
        return { ...fail(runId, profileId, facts.code, "confirmed"), evidence };
      if (interrupt())
        return {
          ...fail(runId, profileId, interrupt(), "confirmed"),
          evidence,
        };
      return {
        outcome: "decoded",
        runId,
        profileId,
        facts: facts.facts,
        stopped: "confirmed",
        evidence,
      };
    }
    if (FAULTS.has(scenario)) {
      const parsed = parseWorkerOutput(output.stdout, {
        width: 2,
        height: 2,
        mediaType: "image/png",
      });
      return {
        ...fail(
          runId,
          profileId,
          parsed.ok ? "WORKER_FAILED" : parsed.code,
          "confirmed",
        ),
        evidence,
      };
    }
    return {
      outcome: "probe",
      runId,
      profileId,
      stopped: "confirmed",
      stdout: output.stdout,
      evidence,
    };
  } catch (e) {
    const known = new Set([
      "UNSUPPORTED_PLATFORM",
      "ENDPOINT_OVERRIDE",
      "PRECHECK_INTERRUPTED",
      "IMAGE_IDENTITY",
      "WORKER_CHANGED",
      "BUILD_INPUT_CHANGED",
      "MISSING_IMAGE",
      "DAEMON_UNAVAILABLE",
      "CAPABILITY_UNAVAILABLE",
      "DEPENDENCIES_CHANGED",
      "DEPENDENCIES_UNVERIFIED",
    ]);
    hooks.diagnostic?.({
      phase: "launcher-catch",
      failure: known.has(e?.message) ? e.message : "INTERNAL_OR_IO_FAILURE",
      issued,
    });
    if (issued) return fail(runId, profileId, "STOP_UNCONFIRMED", "unknown");
    return fail(
      runId,
      profileId,
      interrupt() ?? "ISOLATION_UNAVAILABLE",
      "not-started",
    );
  } finally {
    // Before issuance only. Unknown started executions retain both fixed objects.
    if (guardOwned && !issued) {
      try {
        if (record && hash(await readPrivate(RECORD)) === record.recordHash)
          await unlink(RECORD);
        if ((await readPrivate(GUARD, 128)).toString() === runId)
          await unlink(GUARD);
      } catch {
        /* conservative stale guard */
      }
    }
    activeExecutions.delete(runId);
  }
}
// Explicit harness recovery after unknown. No new execution, no stale-PID inference.
export async function verifyOwnStopped(beforeStartCrash) {
  if (recoveryActive) return { stopped: "unknown" };
  recoveryActive = true;
  const deadline = performance.now() + LIMITS.cleanupMs;
  try {
    const persisted = await readPrivate(RECORD);
    const record = json(persisted);
    if (
      record.schema !== "qf-linux-run.v1" ||
      !/^[a-f0-9-]{36}$/.test(record.runId) ||
      record.name !== `qf-media-${record.runId}` ||
      !/^[a-f0-9]{64}$/.test(record.nonce) ||
      !/^sha256:[a-f0-9]{64}$/.test(record.imageId) ||
      !/^[a-f0-9]{64}$/.test(record.profileId) ||
      (await readPrivate(GUARD, 128)).toString() !== record.runId
    )
      return { stopped: "unknown" };
    if (
      activeExecutions.has(record.runId) ||
      controlStates.get(record.runId)?.pending ||
      controlStates.get(record.runId)?.unsettled
    )
      return { stopped: "unknown" };
    const ownCrash =
      beforeStartCrash?.ownerClosed === true &&
      beforeStartCrash?.createClosed === true &&
      beforeStartCrash.ownerPid === record.ownerPid &&
      beforeStartCrash.recordSha256 === hash(persisted);
    if (!localBarriers.has(record.runId) && !ownCrash)
      return { stopped: "unknown" };
    const policy = await loadPolicy({
      deadline,
      controlCommand: (args, options) => ownedDocker(record, args, options),
    });
    if (
      record.profileId !== policy.profileId ||
      record.daemonId !== policy.binding.daemon.id
    )
      return { stopped: "unknown" };
    // Same-process actual close or a fixed created-only crash-window receipt.
    if (!localBarriers.has(record.runId) && !ownCrash)
      return { stopped: "unknown" };
    record.recordHash = hash(persisted);
    let c = await inspect(record, deadline);
    if (!c || (ownCrash && c.state.Status !== "created"))
      return { stopped: "unknown" };
    if (ownCrash) {
      const state = controlStates.get(record.runId);
      if (!state || state.pending || state.unsettled)
        return { stopped: "unknown" };
      state.originKnown = true;
      localBarriers.add(record.runId);
    }
    if (c.state.Running) {
      const killed = await ownedDocker(
        record,
        ["kill", "--signal=SIGKILL", c.id],
        {
          deadline: deadline - 100,
          settleDeadline: deadline,
        },
      );
      if (!killed.settled) {
        localBarriers.delete(record.runId);
        return { stopped: "unknown" };
      }
    }
    if (c.state.Status !== "created") {
      const w = await ownedDocker(record, ["wait", c.id], {
        deadline: deadline - 100,
        settleDeadline: deadline,
      });
      if (w.code !== 0 || w.reason || !w.settled) return { stopped: "unknown" };
    }
    c = await inspect(record, deadline);
    if (
      !c ||
      c.state.Running ||
      c.state.Restarting ||
      !["exited", "created"].includes(c.state.Status)
    )
      return { stopped: "unknown" };
    // Recovery proves container stop; cannot assert a crashed parent's stdio barrier.
    // Explicit harness only calls after independently observed parent/CLI close.
    if (!(await removeConfirmed(record, c, deadline)))
      return { stopped: "unknown" };
    return { stopped: "confirmed", containerStopped: true };
  } catch {
    return { stopped: "unknown" };
  } finally {
    recoveryActive = false;
  }
}

// Frozen shared precheck snapshot and strict worker output; no business imports.
export async function runIsolatedImage(bytes, expected, context) {
  const runId = randomUUID();
  const start = performance.now();
  const checked = precheckImage(bytes, expected);
  if (!checked.ok) return fail(runId, null, checked.code, "not-started");
  let signal, callerDeadline;
  try {
    signal = context?.signal;
    callerDeadline = context?.deadlineMonotonicMs;
  } catch {
    return fail(runId, null, "INVALID_INPUT", "not-started");
  }
  if (!(signal instanceof AbortSignal) || !Number.isFinite(callerDeadline))
    return fail(runId, null, "INVALID_INPUT", "not-started");
  const deadline = Math.min(callerDeadline, start + LIMITS.executionMs);
  if (signal.aborted) return fail(runId, null, "CANCELLED", "not-started");
  if (platform() !== "linux" || arch() !== "x64")
    return fail(runId, null, "UNSUPPORTED_PLATFORM", "not-started");
  const result = await executeSynthetic({
    bytes: checked.bytes,
    expected: checked.expected,
    signal,
    deadlineMonotonicMs: deadline,
    preallocatedRunId: runId,
  });
  if (result.outcome === "decoded") {
    if (signal.aborted)
      return fail(runId, result.profileId, "CANCELLED", "confirmed");
    if (performance.now() >= deadline)
      return fail(runId, result.profileId, "DEADLINE_EXCEEDED", "confirmed");
    return {
      outcome: "decoded",
      runId,
      profileId: result.profileId,
      facts: result.facts,
      stopped: "confirmed",
    };
  }
  return fail(runId, result.profileId, result.code, result.stopped);
}
