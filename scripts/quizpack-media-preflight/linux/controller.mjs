import { createTrustedMediaRuntime } from "../../../src/features/quizpack/server/media/internal/runtime.ts";
import { createLinuxExecutionCore } from "../../../src/features/quizpack/server/media/internal/linux/execute.mjs";
import {
  createMediaOperationContext,
  beginMediaImage,
  readMediaOperationState,
  disposeMediaOperationContext,
} from "../../../src/features/quizpack/server/media/operation-context.ts";
import { mediaStopFailureCode } from "../../../src/features/quizpack/server/media/contracts.ts";
import { parseWorkerOutput } from "../shared/output.ts";
import { precheckImage } from "../shared/precheck.ts";
import { platform, arch } from "node:os";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  CACHE,
  STATE,
  RUNTIME_TARGET,
  RUNTIME_ROOTS,
  CORE_DIR,
  hash,
  privateDir,
  writePrivate,
  readPrivate,
  docker,
  json,
} from "./common.mjs";
import { LIMITS, loadPolicy } from "./policy.mjs";

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
const core = createLinuxExecutionCore({
  controlRoot: resolve(STATE, "control"),
  seccompPath: resolve(CORE_DIR, "seccomp.json"),
  hash,
  privateDir,
  writePrivate,
  readPrivate,
  docker,
  json,
  loadPolicy,
});
export const verifyOwnStopped = core.verifyOwnStopped;
export async function executeSynthetic(options = {}) {
  const {
    scenario = "normal",
    bytes = Buffer.alloc(0),
    expected,
    signal = new AbortController().signal,
    deadlineMonotonicMs = performance.now() + 5000,
    syntheticRoot,
    hooks = {},
    preallocatedRunId = randomUUID(),
  } = options;
  const context = createMediaOperationContext({ signal, deadlineMonotonicMs });
  const scope = beginMediaImage(context);
  try {
    if (!scope) {
      const state = readMediaOperationState(context);
      return fail(
        preallocatedRunId,
        null,
        state.phase === "stopping" ? mediaStopFailureCode(state.stop) : "BUSY",
        "not-started",
      );
    }
    const result = await core.execute({
      execution: fixedScenario(scenario, syntheticRoot),
      scope,
      bytes,
      hooks: {
        ...hooks,
        afterPolicy(policy) {
          if (scenario !== "identity" && !policy.binding.dependencies)
            throw new Error("DEPENDENCIES_UNVERIFIED");
        },
      },
      preallocatedRunId,
    });
    if (result.outcome !== "exited") return result;
    if (scenario === "normal") {
      const facts = parseWorkerOutput(result.stdout, expected);
      return facts.ok
        ? {
            outcome: "decoded",
            runId: result.runId,
            profileId: result.profileId,
            facts: facts.facts,
            stopped: "confirmed",
            evidence: result.evidence,
          }
        : {
            ...fail(result.runId, result.profileId, facts.code, "confirmed"),
            evidence: result.evidence,
          };
    }
    if (FAULTS.has(scenario)) {
      const facts = parseWorkerOutput(result.stdout, {
        width: 2,
        height: 2,
        mediaType: "image/png",
      });
      return {
        ...fail(
          result.runId,
          result.profileId,
          facts.ok ? "WORKER_FAILED" : facts.code,
          "confirmed",
        ),
        evidence: result.evidence,
      };
    }
    return { ...result, outcome: "probe" };
  } catch {
    return fail(
      preallocatedRunId,
      null,
      "ISOLATION_UNAVAILABLE",
      "not-started",
    );
  } finally {
    scope?.finish();
    disposeMediaOperationContext(context);
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
  if (RUNTIME_TARGET) {
    const operation = createMediaOperationContext({
      signal,
      deadlineMonotonicMs: deadline,
    });
    try {
      return await createTrustedMediaRuntime(RUNTIME_ROOTS).run(
        checked.bytes,
        checked.expected,
        operation,
        "candidate",
      );
    } finally {
      disposeMediaOperationContext(operation);
    }
  }
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
