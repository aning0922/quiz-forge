import "server-only";
import { classifySystemError } from "./diagnostic.ts";
import { mediaStopFailureCode } from "../../contracts.ts";
import { randomUUID, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { unlink, lstat } from "node:fs/promises";
import {
  LIMITS,
  INSPECT,
  containerChecks,
  createArgs as createCoreArgs,
} from "./container-policy.mjs";
export function createLinuxExecutionCore(environment) {
  const {
    hash,
    privateDir,
    writePrivate,
    readPrivate,
    docker,
    json,
    loadPolicy,
  } = environment;
  const createArgs = (record, entrypoint, args) =>
    createCoreArgs(record, entrypoint, args, environment.seccompPath);
  const CONTROL = environment.controlRoot;
  const RECORD = resolve(CONTROL, "record.json");
  const POLICY = resolve(CONTROL, "policy.json");
  const policyRecords = new Map();
  const GUARD = resolve(CONTROL, "guard");
  const localBarriers = new Set();
  const activeScopes = new Map();
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
      const result = await docker(args, {
        ...options,
        scope: activeScopes.get(record.runId),
      });
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
  const withinBudget = (runId) => {
    const state = activeScopes.get(runId)?.readState();
    const end =
      state?.phase === "stopping"
        ? state.stop.cleanupDeadlineMonotonicMs
        : activeScopes.get(runId)?.deadlineMonotonicMs;
    return end !== undefined && performance.now() < end;
  };
  async function ownedPolicyDocker(record, args, options) {
    if (!policyRecords.has(record.runId)) {
      if (!withinBudget(record.runId)) throw new Error("PRECHECK_INTERRUPTED");
      const bytes = JSON.stringify({
        schema: "qf-linux-policy-run.v1",
        runId: record.runId,
        ownerPid: process.pid,
        phase: "policy-issued",
        imageId: null,
        profileId: null,
      });
      await writePrivate(POLICY, bytes);
      policyRecords.set(record.runId, hash(bytes));
      if (!withinBudget(record.runId)) throw new Error("PRECHECK_INTERRUPTED");
    }
    const state = controlStates.get(record.runId);
    if (state) state.originKnown = true;
    else
      controlStates.set(record.runId, {
        pending: 0,
        unsettled: false,
        originKnown: true,
      });
    return ownedDocker(record, args, options);
  }
  async function clearPolicyRecord(runId) {
    const state = controlStates.get(runId);
    if (state?.pending || state?.unsettled) return false;
    const expectedHash = policyRecords.get(runId);
    if (expectedHash === undefined) return true;
    if (
      !withinBudget(runId) ||
      hash(await readPrivate(POLICY)) !== expectedHash ||
      !withinBudget(runId)
    )
      return false;
    await unlink(POLICY);
    if (!withinBudget(runId)) return false;
    policyRecords.delete(runId);
    return true;
  }
  async function clearLocalGuard(runId) {
    if (!(await clearPolicyRecord(runId)) || !withinBudget(runId)) return false;
    if (
      (await readPrivate(GUARD, 128)).toString() !== runId ||
      !withinBudget(runId)
    )
      return false;
    await unlink(GUARD);
    controlStates.delete(runId);
    localBarriers.delete(runId);
    return withinBudget(runId);
  }
  async function readPolicy({ scope, hooks = {} }) {
    const runId = randomUUID();
    const record = { runId };
    if (recoveryActive) throw new Error("BUSY");
    activeExecutions.add(runId);
    activeScopes.set(runId, scope);
    let guardOwned = false;
    try {
      const state = scope.readState();
      if (state.phase === "stopping")
        throw new Error(mediaStopFailureCode(state.stop));
      await privateDir(CONTROL);
      for (const path of [RECORD, POLICY]) {
        try {
          await lstat(path);
          throw new Error("BUSY");
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      if (!withinBudget(runId)) throw new Error("PRECHECK_INTERRUPTED");
      try {
        await writePrivate(GUARD, runId);
        guardOwned = true;
      } catch {
        throw new Error("BUSY");
      }
      const policy = await loadPolicy({
        deadline: scope.deadlineMonotonicMs,
        signal: scope.signal,
        scope,
        onDiagnostic: hooks.diagnostic,
        controlCommand: (args, options) =>
          ownedPolicyDocker(record, args, options),
      });
      if (!(await clearLocalGuard(runId))) throw new Error("STOP_UNCONFIRMED");
      guardOwned = false;
      return policy;
    } catch (error) {
      if (guardOwned) {
        const commands = controlStates.get(runId);
        if (
          commands?.pending ||
          commands?.unsettled ||
          !(await clearLocalGuard(runId))
        ) {
          scope.requestStop("STOP_UNCONFIRMED");
          throw new Error("STOP_UNCONFIRMED");
        }
      }
      throw error;
    } finally {
      activeExecutions.delete(runId);
      activeScopes.delete(runId);
    }
  }
  const fail = (runId, profileId, code, stopped) => ({
    outcome: "failed",
    runId,
    profileId,
    code,
    stopped,
  });
  async function inspect(record, deadline, onDiagnostic) {
    const r = await ownedDocker(
      record,
      ["inspect", "--format", INSPECT, record.name],
      {
        deadline: deadline - 100,
        settleDeadline: deadline,
        phase: "cleanup",
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
    const withinBudget = () => {
      const state = activeScopes.get(record.runId)?.readState();
      return (
        performance.now() < deadline &&
        (state?.phase !== "stopping" ||
          performance.now() < state.stop.cleanupDeadlineMonotonicMs)
      );
    };
    if (!withinBudget()) return false;
    // Exact ID after identity verification. No force, volumes, broad filters, or --rm.
    const r = await ownedDocker(record, ["rm", container.id], {
      deadline: deadline - 100,
      settleDeadline: deadline,
      phase: "cleanup",
    });
    if (r.code !== 0 || r.reason || !r.settled) return false;
    if (r.stdout.toString("utf8").trim() !== container.id) return false;
    // Fixed private identities must still be our bytes before local deletion.
    if (
      hash(await readPrivate(RECORD)) !== record.recordHash ||
      !withinBudget()
    )
      return false;
    if (
      (await readPrivate(GUARD, 128)).toString() !== record.runId ||
      !withinBudget()
    )
      return false;
    await unlink(RECORD);
    if (!withinBudget()) return false;
    await unlink(GUARD);
    if (!withinBudget()) return false;
    localBarriers.delete(record.runId);
    controlStates.delete(record.runId);
    return true;
  }
  // Internal closed synthetic harness. Normal entry below always runs shared precheck.
  // No P1 or business entry imports this candidate.
  async function execute({
    execution,
    scope,
    bytes = Buffer.alloc(0),
    deadlineMonotonicMs = scope.deadlineMonotonicMs,
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
    const signal = scope.signal;
    const interrupt = () => {
      const state = scope.readState();
      return state.phase === "stopping"
        ? mediaStopFailureCode(state.stop)
        : null;
    };
    const currentDeadline = () => {
      const state = scope.readState();
      return state.phase === "stopping"
        ? state.stop.cleanupDeadlineMonotonicMs
        : deadline;
    };
    if (recoveryActive) return fail(runId, null, "BUSY", "not-started");
    if (snapshot.length > LIMITS.bytes)
      return fail(runId, null, "INPUT_LIMIT", "not-started");
    if (interrupt()) return fail(runId, null, interrupt(), "not-started");
    activeExecutions.add(runId);
    activeScopes.set(runId, scope);
    try {
      await privateDir(CONTROL);
      // Never steal stale guards. Incomplete/unknown records block restart.
      for (const path of [RECORD, POLICY]) {
        try {
          await lstat(path);
          return fail(runId, null, "BUSY", "not-started");
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
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
        scope,
        controlCommand: (args, options) =>
          ownedPolicyDocker({ runId }, args, options),
      });
      profileId = policy.profileId;
      await hooks.afterPolicy?.(policy);
      if (interrupt())
        return fail(runId, profileId, interrupt(), "not-started");
      if (!(await clearPolicyRecord(runId)))
        return fail(runId, profileId, "STOP_UNCONFIRMED", "unknown");
      const spec = execution;
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
        return fail(runId, profileId, interrupt(), "not-started");
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
        container = await inspect(record, currentDeadline(), hooks.diagnostic);
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
      if (reason)
        scope.requestStop(
          reason === "CANCELLED"
            ? "CANCELLED"
            : reason === "DEADLINE_EXCEEDED"
              ? "IMAGE_DEADLINE_EXCEEDED"
              : reason === "STOP_UNCONFIRMED"
                ? "STOP_UNCONFIRMED"
                : "RUNTIME_FAILED",
        );
      const cleanupDeadline = currentDeadline();
      // One stop path for decode, failure, cancellation. Inspect/wait are authoritative.
      container = await inspect(record, cleanupDeadline, hooks.diagnostic);
      if (!container)
        return fail(runId, profileId, "STOP_UNCONFIRMED", "unknown");
      if (container.state.Running || container.state.Status === "created") {
        if (container.state.Running) {
          const killed = await ownedDocker(
            record,
            ["kill", "--signal=SIGKILL", container.id],
            {
              deadline: cleanupDeadline - 100,
              settleDeadline: cleanupDeadline,
              phase: "cleanup",
            },
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
              phase: "cleanup",
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
      if (final.state.ExitCode !== 0)
        return {
          ...fail(runId, profileId, "WORKER_FAILED", "confirmed"),
          evidence,
        };
      if (interrupt())
        return {
          ...fail(runId, profileId, interrupt(), "confirmed"),
          evidence,
        };
      return {
        outcome: "exited",
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
        "RUNTIME_VERSION_UNAVAILABLE",
        "RUNTIME_VERSION_CHANGED",
      ]);
      hooks.diagnostic?.({
        phase: "launcher-catch",
        failure: known.has(e?.message) ? e.message : "INTERNAL_OR_IO_FAILURE",
        issued,
      });
      if (
        issued ||
        controlStates.get(runId)?.pending ||
        controlStates.get(runId)?.unsettled
      ) {
        scope.requestStop("STOP_UNCONFIRMED");
        return fail(runId, profileId, "STOP_UNCONFIRMED", "unknown");
      }
      return fail(
        runId,
        profileId,
        interrupt() ?? "ISOLATION_UNAVAILABLE",
        "not-started",
      );
    } finally {
      // Before issuance only. Unknown started executions retain both fixed objects.
      if (
        guardOwned &&
        !issued &&
        !controlStates.get(runId)?.pending &&
        !controlStates.get(runId)?.unsettled
      ) {
        try {
          if (record && hash(await readPrivate(RECORD)) === record.recordHash)
            await unlink(RECORD);
          await clearLocalGuard(runId);
        } catch {
          /* conservative stale guard */
        }
      }
      activeExecutions.delete(runId);
      activeScopes.delete(runId);
    }
  }
  // Explicit harness recovery after unknown. No new execution, no stale-PID inference.
  async function verifyOwnStopped(beforeStartCrash) {
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
        if (w.code !== 0 || w.reason || !w.settled)
          return { stopped: "unknown" };
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

  return { execute, readPolicy, verifyOwnStopped };
}
