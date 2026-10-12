import "server-only";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { verifyMediaDeployment } from "../../../../../lib/build/media-deployment";
import {
  MEDIA_LIMITS,
  mediaStopFailureCode,
  type ImageDeclaration,
  type LaunchFailureCode,
  type LaunchResult,
  type MediaOperationContext,
  type MediaRuntimeBinding,
  type MediaRuntimeBindingResult,
} from "../contracts";
import { beginMediaImage, createMediaControlScope } from "../operation-context";
import { readMediaCapability } from "./capability";
import { hashBytes, MediaPolicyError } from "./runtime-files";
import {
  fixedMediaPlatformRoles,
  type MediaRuntimeRoots,
} from "./runtime-location";
import { loadMacPolicy } from "./macos/policy";
import { createMacControl, ensurePrivateDirectory } from "./macos/control";
import { runOwnedMac } from "./macos/execute";
import {
  createLinuxNormalRuntime,
  type LinuxNormalPolicy,
} from "./linux/policy";
import { precheckImage } from "./shared/precheck";
import { parseWorkerOutput } from "./shared/output";

type Scope = ReturnType<typeof createMediaControlScope>;
export type MediaSealCandidateResult =
  | Extract<MediaRuntimeBindingResult, { outcome: "unavailable" }>
  | Readonly<{
      outcome: "bound";
      binding: MediaRuntimeBinding;
      profileId: string;
    }>;
type Authorization = "candidate" | "sealed";
class Interrupted extends Error {
  constructor(readonly code: LaunchFailureCode) {
    super(code);
  }
}
function checkpoint(scope: Scope): void {
  const state = scope.readState();
  if (state.phase === "stopping")
    throw new Interrupted(mediaStopFailureCode(state.stop));
}
function failureCode(error: unknown, scope: Scope): LaunchFailureCode {
  try {
    checkpoint(scope);
  } catch (interrupted) {
    if (interrupted instanceof Interrupted) return interrupted.code;
    return "INVALID_INPUT";
  }
  if (error instanceof Interrupted || error instanceof MediaPolicyError) {
    if (error.code === "STOP_UNCONFIRMED")
      scope.requestStop("STOP_UNCONFIRMED");
    return error.code;
  }
  return "ISOLATION_UNAVAILABLE";
}
const failed = (
  runId: string,
  profileId: string | null,
  code: LaunchFailureCode,
  stopped: "not-started" | "confirmed" | "unknown" = "not-started",
): LaunchResult => ({
  outcome: "failed",
  runId,
  profileId,
  code,
  stopped: code === "STOP_UNCONFIRMED" ? "unknown" : stopped,
});

/** Internal trusted roots only. The ordinary entry uses compiler literals and sealed mode. */
export function createTrustedMediaRuntime(roots: MediaRuntimeRoots) {
  const pinned = new WeakMap<MediaOperationContext, string>();
  async function load(
    context: MediaOperationContext,
    scope: Scope,
    authorization: Authorization,
    runId?: string,
  ) {
    const check = () => checkpoint(scope);
    check();
    const platform =
      process.platform === "darwin" && process.arch === "arm64"
        ? "darwin-arm64"
        : process.platform === "linux" && process.arch === "x64"
          ? "linux-x64"
          : null;
    if (!platform) throw new MediaPolicyError("UNSUPPORTED_PLATFORM");
    const deployment = await verifyMediaDeployment(roots, {
      deadlineMonotonicMs: scope.deadlineMonotonicMs,
      signal: scope.signal,
      checkpoint: check,
    });
    check();
    if (!deployment.ok) throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
    const roles = fixedMediaPlatformRoles(roots, platform);
    ensurePrivateDirectory(roles.stateRoot, roots.checkoutRoot);
    check();
    const mac =
      platform === "darwin-arm64"
        ? loadMacPolicy(
            {
              checkoutRoot: roots.checkoutRoot,
              identityHelper: roles.identityHelper,
            },
            check,
          )
        : null;
    const linux =
      platform === "linux-x64"
        ? createLinuxNormalRuntime(
            { checkoutRoot: roots.checkoutRoot, ...roles },
            check,
          )
        : null;
    const policy =
      mac ??
      ((await linux!.core.readPolicy({
        scope,
        ...(runId ? { preallocatedRunId: runId } : {}),
      })) as LinuxNormalPolicy);
    check();
    const limitsHash = hashBytes(JSON.stringify(MEDIA_LIMITS));
    const binding: MediaRuntimeBinding = Object.freeze({
      schema: "quizpack-media-runtime-binding.v1",
      platform,
      componentId: policy.componentId,
      deploymentId: deployment.summary.deploymentId,
      limitsHash,
      runtimeBundleHash: hashBytes(
        JSON.stringify({
          schema: "quizpack-media-runtime-bundle.v1",
          sourceBundleHash: deployment.summary.sourceBundleHash,
          deploymentId: deployment.summary.deploymentId,
          componentId: policy.componentId,
          limitsHash,
        }),
      ),
    });
    if (authorization === "sealed") {
      const seal = readMediaCapability(roles.capability, check);
      if (
        seal.platform !== platform ||
        seal.profileId !== policy.profileId ||
        seal.componentId !== binding.componentId ||
        seal.deploymentId !== binding.deploymentId ||
        seal.runtimeBundleHash !== binding.runtimeBundleHash ||
        seal.limitsHash !== binding.limitsHash
      )
        throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
    }
    const identity = JSON.stringify(binding);
    const previous = pinned.get(context);
    if (previous && previous !== identity)
      throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
    check();
    pinned.set(context, identity);
    return { binding, policy, mac, linux, roles };
  }
  return Object.freeze({
    /** Safe offline seal candidate; has no path, process or daemon facts. */
    async readSealCandidate(
      context: MediaOperationContext,
    ): Promise<MediaSealCandidateResult> {
      let scope: Scope;
      try {
        scope = createMediaControlScope(context);
      } catch {
        return { outcome: "unavailable", code: "INVALID_INPUT" };
      }
      try {
        const value = await load(context, scope, "candidate");
        return {
          outcome: "bound",
          binding: value.binding,
          profileId: value.policy.profileId,
        };
      } catch (error) {
        const code = failureCode(error, scope);
        return {
          outcome: "unavailable",
          code:
            code === "BUSY" ||
            code === "INPUT_LIMIT" ||
            code === "DECODE_REJECTED" ||
            code === "OUTPUT_INVALID"
              ? "ISOLATION_UNAVAILABLE"
              : code,
        };
      }
    },
    async readBinding(
      context: MediaOperationContext,
      authorization: Authorization,
    ): Promise<MediaRuntimeBindingResult> {
      let scope: Scope;
      try {
        scope = createMediaControlScope(context);
      } catch {
        return { outcome: "unavailable", code: "INVALID_INPUT" };
      }
      try {
        return {
          outcome: "bound",
          binding: (await load(context, scope, authorization)).binding,
        };
      } catch (error) {
        const code = failureCode(error, scope);
        return {
          outcome: "unavailable",
          code:
            code === "BUSY" ||
            code === "INPUT_LIMIT" ||
            code === "DECODE_REJECTED" ||
            code === "OUTPUT_INVALID"
              ? "ISOLATION_UNAVAILABLE"
              : code,
        };
      }
    },
    async run(
      bytes: Uint8Array,
      declaration: ImageDeclaration,
      context: MediaOperationContext,
      authorization: Authorization,
    ): Promise<LaunchResult> {
      const runId = randomUUID(),
        start = performance.now();
      let scope: Scope | null;
      try {
        scope = beginMediaImage(context);
      } catch {
        return failed(runId, null, "INVALID_INPUT");
      }
      if (!scope) {
        try {
          const state = createMediaControlScope(context).readState();
          return failed(
            runId,
            null,
            state.phase === "stopping"
              ? mediaStopFailureCode(state.stop)
              : "BUSY",
          );
        } catch {
          return failed(runId, null, "INVALID_INPUT");
        }
      }
      let profileId: string | null = null;
      let stopped: "not-started" | "confirmed" | "unknown" = "not-started";
      try {
        checkpoint(scope);
        const input = precheckImage(bytes, declaration);
        checkpoint(scope);
        if (!input.ok) return failed(runId, null, input.code);
        const runtime = await load(context, scope, authorization, runId);
        profileId = runtime.policy.profileId;
        checkpoint(scope);
        let output: Buffer;
        if (runtime.mac) {
          const control = createMacControl({
            checkoutRoot: roots.checkoutRoot,
            controlRoot: runtime.roles.controlRoot,
          });
          const result = await runOwnedMac(
            runId,
            {
              executable: runtime.mac.node,
              args: [
                runtime.roles.worker,
                String(MEDIA_LIMITS.bytes),
                String(MEDIA_LIMITS.dimension),
                String(MEDIA_LIMITS.pixels),
              ],
              bytes: input.bytes,
              policy: runtime.mac,
            },
            scope,
            start,
            {
              checkoutRoot: roots.checkoutRoot,
              identityHelper: runtime.roles.identityHelper,
              acquireControl: control.acquireControl,
            },
          );
          if (result.code)
            return failed(runId, profileId, result.code, result.stopped);
          if (result.stopped !== "confirmed") {
            scope.requestStop("STOP_UNCONFIRMED");
            return failed(runId, profileId, "STOP_UNCONFIRMED", "unknown");
          }
          stopped = "confirmed";
          output = result.output;
        } else {
          const result = await runtime.linux!.core.execute({
            bytes: input.bytes,
            scope,
            preallocatedRunId: runId,
            execution: {
              entrypoint: "/usr/local/bin/node",
              args: [
                "/worker/media-worker.mjs",
                String(MEDIA_LIMITS.bytes),
                String(MEDIA_LIMITS.dimension),
                String(MEDIA_LIMITS.pixels),
              ],
            },
            hooks: {
              afterPolicy(policy) {
                checkpoint(scope!);
                if (
                  policy.profileId !== runtime.policy.profileId ||
                  (policy as LinuxNormalPolicy).componentId !==
                    runtime.binding.componentId
                )
                  throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
              },
            },
          });
          if (result.outcome === "failed")
            return failed(runId, result.profileId, result.code, result.stopped);
          stopped = "confirmed";
          output = result.stdout;
        }
        const state = scope.readState();
        if (state.phase === "stopping")
          return failed(
            runId,
            profileId,
            mediaStopFailureCode(state.stop),
            "confirmed",
          );
        const parsed = parseWorkerOutput(output, input.expected);
        checkpoint(scope);
        if (!parsed.ok)
          return failed(runId, profileId, parsed.code, "confirmed");
        return {
          outcome: "decoded",
          runId,
          profileId,
          facts: parsed.facts,
          stopped: "confirmed",
        };
      } catch (error) {
        const code = failureCode(error, scope);
        return failed(runId, profileId, code, stopped);
      } finally {
        scope.finish();
      }
    },
  });
}
