import "server-only";
import { createHash } from "node:crypto";
import { canonicalP1Json } from "../../v1/canonical";
import { DEFAULT_COMPATIBILITY_POLICY } from "../../v1/compatibility";
import { PACK_LIMITS } from "../../v1/limits";
import {
  parseMediaRuntimeBinding,
  readMediaRuntimeBinding,
  type MediaRuntimeBinding,
  type MediaRuntimeBindingResult,
} from "../media";
import { validationIdentitySchema, type ValidationIdentity } from "./contracts";
import { REPORT_SCHEMA_HASH } from "./report";
import { PERSISTENCE_UNICODE_POLICY_HASH } from "./unicode";
import {
  ValidationInterrupted,
  type ValidationOperationScope,
} from "./operation-scope";
const hash = (input: Uint8Array | string) =>
  createHash("sha256").update(input).digest("hex");
const COMPATIBILITY_HASH = hash(canonicalP1Json(DEFAULT_COMPATIBILITY_POLICY));
const LIMITS_HASH = hash(canonicalP1Json(PACK_LIMITS));
const BINDING_UNAVAILABLE_CODES: Record<
  Extract<MediaRuntimeBindingResult, { outcome: "unavailable" }>["code"],
  true
> = {
  INVALID_INPUT: true,
  CANCELLED: true,
  DEADLINE_EXCEEDED: true,
  UNSUPPORTED_PLATFORM: true,
  ISOLATION_UNAVAILABLE: true,
  WORKER_FAILED: true,
  STOP_UNCONFIRMED: true,
};
export function runtimeIdentity(
  binding: MediaRuntimeBinding,
): ValidationIdentity {
  const payload = {
    schemaVersion: "quizpack-validation-identity.v1" as const,
    validatorVersion: "1.0.0" as const,
    policyId: "quizpack-local-p1.v1" as const,
    // Runtime bundle binds the complete validation execution closure, not source alone.
    validatorBundleSha256: binding.runtimeBundleHash,
    compatibilityPolicyHash: COMPATIBILITY_HASH,
    effectiveLimitsHash: LIMITS_HASH,
    persistencePolicyVersion: "quizpack-persistence-policy.v1" as const,
    persistencePolicyHash: PERSISTENCE_UNICODE_POLICY_HASH,
    reportSchemaVersion: "quizpack-validation.v1" as const,
    reportSchemaHash: REPORT_SCHEMA_HASH,
    runtime: binding,
  };
  return validationIdentitySchema.parse({
    ...payload,
    identitySha256: hash(canonicalP1Json(payload)),
  });
}

export async function readTrustedBinding(
  scope: ValidationOperationScope,
): Promise<MediaRuntimeBinding> {
  const { context, checkpoint, requestStop, awaitOperationTask } = scope;
  const unknownBinding = (): never => {
    scope.runtimeFailure = "STOP_UNCONFIRMED";
    scope.runtimeIoUnconfirmed = true;
    requestStop(true);
    throw new ValidationInterrupted("MEDIA_STOP_UNCONFIRMED");
  };
  const read = async (): Promise<MediaRuntimeBinding> => {
    let result: MediaRuntimeBindingResult;
    try {
      // A resolving outer Promise does not prove the platform's control IO
      // stopped. Require one complete finite authority result first.
      const raw: unknown = JSON.parse(
        canonicalP1Json(
          await awaitOperationTask(readMediaRuntimeBinding(context)),
        ),
      );
      if (raw === null || typeof raw !== "object" || Array.isArray(raw))
        return unknownBinding();
      const fields = raw as Record<string, unknown>;
      if (
        fields.outcome === "bound" &&
        Object.keys(fields).sort().join() === "binding,outcome"
      ) {
        const parsed = parseMediaRuntimeBinding(
          Buffer.from(canonicalP1Json(fields.binding)),
        );
        if (!parsed.ok) return unknownBinding();
        result = { outcome: "bound", binding: parsed.value };
      } else if (
        fields.outcome === "unavailable" &&
        Object.keys(fields).sort().join() === "code,outcome" &&
        typeof fields.code === "string" &&
        Object.hasOwn(BINDING_UNAVAILABLE_CODES, fields.code)
      ) {
        result = {
          outcome: "unavailable",
          code: fields.code as Extract<
            MediaRuntimeBindingResult,
            { outcome: "unavailable" }
          >["code"],
        };
      } else return unknownBinding();
    } catch {
      return unknownBinding();
    }
    if (result.outcome === "unavailable") {
      // Preserve authoritative uncertainty before a simultaneously triggered
      // storage/cancel checkpoint can throw a less-specific interruption.
      scope.runtimeFailure = result.code;
      if (result.code === "STOP_UNCONFIRMED") scope.runtimeIoUnconfirmed = true;
    }
    checkpoint();
    if (result.outcome === "unavailable") {
      requestStop(result.code === "STOP_UNCONFIRMED");
      throw new ValidationInterrupted(
        result.code === "STOP_UNCONFIRMED"
          ? "MEDIA_STOP_UNCONFIRMED"
          : "RUNTIME_IDENTITY_UNAVAILABLE",
      );
    }
    return result.binding;
  };
  return read();
}
