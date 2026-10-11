import "server-only";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { types } from "node:util";
import {
  classifyMediaFailure,
  mediaStopFailureCode,
  parseLaunchResult,
  parseMediaRuntimeBinding,
  readMediaOperationState,
  readMediaRuntimeBinding,
  requestMediaOperationStop,
  runIsolatedImage,
  type ImageDeclaration,
  type LaunchFailureCode,
  type MediaOperationContext,
  type MediaRuntimeBinding,
} from "../media";
import type {
  QuizPackValidationReport,
  Result,
  ImageFacts,
} from "../../v1/api";
import { canonicalP1Json, P1CanonicalError } from "../../v1/canonical";
import { DEFAULT_COMPATIBILITY_POLICY } from "../../v1/compatibility";
import type { QuizPackContent } from "../../v1/content";
import { PACK_LIMITS } from "../../v1/limits";
import { packIdSchema, type QuizPackManifest } from "../../v1/manifest";
import { validateQuizPackCore } from "../../v1/validate-core";
import { PackToolError, packIssue, readRestrictedZipCore } from "../../v1/zip";
import {
  sealCandidateResultEvidence,
  validationIdentitySchema,
  type CandidateEvidence,
  type CandidateInterruptionCode,
  type MediaFact,
  type ValidationIdentity,
  type POLICY_REJECTION_CODES,
  type CANDIDATE_REJECTION_CODES,
} from "./contracts";
import {
  issuePrivateCandidate,
  type CandidateResult,
} from "./private-candidate";
import { EVIDENCE_LIMITS, REPORT_SCHEMA_HASH, sealP1Report } from "./report";
import {
  assertPersistenceUnicode,
  EvidenceError,
  PERSISTENCE_UNICODE_POLICY_HASH,
} from "./unicode";

const hash = (input: Uint8Array | string) =>
  createHash("sha256").update(input).digest("hex");
const COMPATIBILITY_HASH = hash(canonicalP1Json(DEFAULT_COMPATIBILITY_POLICY));
const LIMITS_HASH = hash(canonicalP1Json(PACK_LIMITS));
type PolicyCode = (typeof POLICY_REJECTION_CODES)[number];
type RejectionCode = (typeof CANDIDATE_REJECTION_CODES)[number];
class BackendPolicyRejection extends Error {
  constructor(readonly code: PolicyCode) {
    super("Backend validation policy rejected.");
  }
}
class CoreInterrupted extends Error {
  report: QuizPackValidationReport | null = null;
  constructor(
    readonly code: CandidateInterruptionCode,
    readonly p1Code = "VALIDATION_FAILED",
  ) {
    super("Trusted validation interrupted.");
  }
}
function runtimeIdentity(binding: MediaRuntimeBinding): ValidationIdentity {
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

function rawVersionGate(
  manifest: unknown,
  content: unknown,
  target: string,
): void {
  const object = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const rawManifest = object(manifest),
    rawContent = object(content);
  // Malformed v1 is still a real P1 structure failure. Explicit non-v1 dispatch is backend policy.
  if (
    rawManifest?.schemaVersion !== undefined &&
    rawManifest.schemaVersion !== "quizpack.v1"
  )
    throw new BackendPolicyRejection("UNSUPPORTED_MANIFEST_VERSION");
  if (
    rawContent?.schemaVersion !== undefined &&
    rawContent.schemaVersion !== "quizpack-content.v1"
  )
    throw new BackendPolicyRejection("UNSUPPORTED_CONTENT_VERSION");
  if (rawContent?.kind === "authored")
    throw new BackendPolicyRejection("AUTHORED_NOT_SUPPORTED");
  const rawProduct = object(rawContent?.product);
  if (
    (typeof rawManifest?.productId === "string" &&
      rawManifest.productId !== target) ||
    (typeof rawProduct?.productId === "string" &&
      rawProduct.productId !== target)
  )
    throw new BackendPolicyRejection("TARGET_PRODUCT_MISMATCH");
}

/** Fixed inspector/policy/deployment entry. No caller-selected execution options. */
export async function validateArchiveCandidate(
  input: Uint8Array,
  targetProductId: string,
  context: MediaOperationContext,
): Promise<CandidateResult> {
  const pendingIo = new Set<Promise<void>>();
  const media: MediaFact[] = [];
  let runtimeFailure: LaunchFailureCode | null = null;
  let identity: CandidateEvidence["identity"] = {
    status: "unavailable",
    code: "RUNTIME_IDENTITY_UNAVAILABLE",
  };
  let inputEvidence: CandidateEvidence["input"] = {
    status: "unavailable",
    code: "INVALID_INPUT",
  };
  let report: CandidateEvidence["report"] = {
    status: "not-run",
    reason: "INPUT_REJECTED",
  };
  let policy: CandidateEvidence["policy"] = { status: "not-run" };
  let archive: Buffer | null = null;
  let parsed: {
    manifest: QuizPackManifest;
    content: QuizPackContent;
    files: ReadonlyMap<string, Buffer>;
  } | null = null;
  let relatedIo: "settled" | "unconfirmed" = "settled";
  let activeMedia = false;
  let runtimeIoUnconfirmed = false;

  const checkpoint = (): void => {
    let state;
    try {
      state = readMediaOperationState(context);
    } catch {
      identity = { status: "unavailable", code: "INVALID_CONTEXT" };
      if (evidence().report.status !== "sealed")
        report = { status: "not-run", reason: "IDENTITY_UNAVAILABLE" };
      throw new CoreInterrupted("INVALID_CONTEXT");
    }
    if (state.phase === "stopping") {
      runtimeFailure ??= mediaStopFailureCode(state.stop);
      throw new CoreInterrupted(
        runtimeFailure === "STOP_UNCONFIRMED"
          ? "MEDIA_STOP_UNCONFIRMED"
          : runtimeFailure === "CANCELLED"
            ? "OPERATION_CANCELLED"
            : runtimeFailure === "DEADLINE_EXCEEDED"
              ? "OPERATION_TIMEOUT"
              : "MEDIA_RUNTIME_FAILED",
        runtimeFailure === "CANCELLED"
          ? "OPERATION_CANCELLED"
          : runtimeFailure === "DEADLINE_EXCEEDED"
            ? "OPERATION_TIMEOUT"
            : "MEDIA_WORKER_FAILED",
      );
    }
  };
  const requestStop = (unknownMedia = false): void => {
    try {
      requestMediaOperationStop(
        context,
        unknownMedia ? "STOP_UNCONFIRMED" : "RUNTIME_FAILED",
      );
    } catch {
      /* Invalid/disposed contexts cannot confer completion authority. */
    }
  };
  const trackIo = (task: Promise<void>): void => {
    pendingIo.add(task);
    void task.then(
      () => pendingIo.delete(task),
      () => pendingIo.delete(task),
    );
  };
  const awaitOperationTask = async <T>(task: Promise<T>): Promise<T> => {
    // Track the operation itself as well as native close. A close proof alone
    // cannot hide a callback still capable of continuing validation work.
    trackIo(
      task.then(
        () => undefined,
        () => undefined,
      ),
    );
    let timer: NodeJS.Timeout | undefined;
    let onAbort: () => void = () => {};
    const stopped = new Promise<never>((_, reject) => {
      const finish = () => {
        if (activeMedia) {
          runtimeFailure = "STOP_UNCONFIRMED";
          runtimeIoUnconfirmed = true;
          requestStop(true);
        }
        reject(
          new CoreInterrupted(
            activeMedia ? "MEDIA_STOP_UNCONFIRMED" : "RELATED_IO_UNCONFIRMED",
          ),
        );
      };
      onAbort = () => {
        try {
          const state = readMediaOperationState(context);
          if (state.phase !== "stopping") return;
          const remaining =
            state.stop.cleanupDeadlineMonotonicMs - performance.now();
          if (remaining <= 0) finish();
          else timer = setTimeout(onAbort, Math.min(remaining, 25));
        } catch {
          finish();
        }
      };
      context.signal.addEventListener("abort", onAbort, { once: true });
      if (context.signal.aborted) onAbort();
    });
    try {
      return await Promise.race([task, stopped]);
    } finally {
      if (timer) clearTimeout(timer);
      context.signal.removeEventListener("abort", onAbort);
    }
  };
  const settleIo = async (): Promise<void> => {
    while (pendingIo.size) {
      let state;
      try {
        state = readMediaOperationState(context);
      } catch {
        relatedIo = "unconfirmed";
        return;
      }
      const deadline =
        state.phase === "stopping"
          ? state.stop.cleanupDeadlineMonotonicMs
          : state.deadlineMonotonicMs;
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        if (state.phase === "stopping") {
          relatedIo = "unconfirmed";
          return;
        }
        // Observe the factory's scheduled deadline; never create another 5s budget.
        readMediaOperationState(context);
        continue;
      }
      let timer: NodeJS.Timeout | undefined;
      let abort: (() => void) | undefined;
      const changed = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, remaining);
        if (state.phase === "active") {
          abort = resolve;
          state.signal.addEventListener("abort", abort, { once: true });
          if (state.signal.aborted) resolve();
        }
      });
      try {
        await Promise.race([Promise.allSettled([...pendingIo]), changed]);
      } finally {
        if (timer) clearTimeout(timer);
        if (abort) state.signal.removeEventListener("abort", abort);
      }
    }
  };
  const evidence = (): CandidateEvidence => {
    const mediaStopped =
      runtimeFailure === "STOP_UNCONFIRMED" ||
      media.some((fact) => fact.result.stopped === "unknown")
        ? "unknown"
        : media.some((fact) => fact.result.stopped === "confirmed")
          ? "confirmed"
          : "not-started";
    return {
      schemaVersion: "quizpack-candidate-evidence.v1",
      input: inputEvidence,
      identity,
      report,
      policy,
      media,
      completion: {
        mediaStopped,
        relatedIo:
          runtimeIoUnconfirmed || mediaStopped === "unknown"
            ? "unconfirmed"
            : relatedIo,
        maintenanceRequired:
          mediaStopped === "unknown" ||
          relatedIo === "unconfirmed" ||
          runtimeIoUnconfirmed,
      },
      runtimeFailure,
    };
  };
  const interrupted = (code: CandidateInterruptionCode): CandidateResult => {
    requestStop(runtimeFailure === "STOP_UNCONFIRMED");
    const sealed = sealCandidateResultEvidence({
      outcome: "interrupted",
      code,
      evidence: evidence(),
    });
    if (sealed.outcome !== "interrupted")
      throw new EvidenceError("EVIDENCE_SCHEMA_INVALID");
    return sealed;
  };
  const rejected = (code: RejectionCode): CandidateResult => {
    const sealed = sealCandidateResultEvidence({
      outcome: "rejected",
      code,
      evidence: evidence(),
    });
    if (sealed.outcome !== "rejected")
      throw new EvidenceError("EVIDENCE_SCHEMA_INVALID");
    return sealed;
  };
  const sealReport = (value: QuizPackValidationReport): void => {
    try {
      report = sealP1Report(value);
    } catch (error) {
      report = {
        status: "invalid",
        code:
          error instanceof EvidenceError && error.code === "REPORT_SIZE_LIMIT"
            ? "REPORT_SIZE_LIMIT"
            : "REPORT_SCHEMA_INVALID",
      };
      throw new CoreInterrupted("BRIDGE_REPORT_INVALID");
    }
  };
  try {
    if (!packIdSchema.safeParse(targetProductId).success) {
      inputEvidence = { status: "unavailable", code: "INVALID_TARGET_PRODUCT" };
      return interrupted("INVALID_TARGET_PRODUCT");
    }
    if (
      !(input instanceof Uint8Array) ||
      types.isProxy(input) ||
      input.buffer instanceof SharedArrayBuffer ||
      input.byteLength > PACK_LIMITS.archiveBytes
    )
      return interrupted("INVALID_INPUT");
    // Before the first await: hash/copy exactly the caller's original bytes once.
    archive = Buffer.from(input);
    inputEvidence = {
      status: "snapshotted",
      archiveSha256: hash(archive),
      archiveBytes: archive.length,
      targetProductId,
    };
    report = { status: "not-run", reason: "OPERATION_INTERRUPTED_BEFORE_P1" };
    checkpoint();
    const bound = await awaitOperationTask(readMediaRuntimeBinding(context));
    checkpoint();
    if (bound.outcome !== "bound") {
      runtimeFailure = bound.code;
      runtimeIoUnconfirmed = bound.code === "STOP_UNCONFIRMED";
      report = { status: "not-run", reason: "IDENTITY_UNAVAILABLE" };
      requestStop(bound.code === "STOP_UNCONFIRMED");
      return interrupted(
        bound.code === "STOP_UNCONFIRMED"
          ? "MEDIA_STOP_UNCONFIRMED"
          : "RUNTIME_IDENTITY_UNAVAILABLE",
      );
    }
    const runtime = parseMediaRuntimeBinding(
      Buffer.from(canonicalP1Json(bound.binding)),
    );
    if (!runtime.ok) throw new CoreInterrupted("RUNTIME_IDENTITY_UNAVAILABLE");
    identity = { status: "bound", value: runtimeIdentity(runtime.value) };
    const operation = readMediaOperationState(context);
    report = { status: "not-run", reason: "OPERATION_INTERRUPTED_BEFORE_P1" };
    const validated = await awaitOperationTask(
      validateQuizPackCore(
        (async function* () {
          yield archive!;
        })(),
        {
          targetProductId,
          compatibilityPolicy: DEFAULT_COMPATIBILITY_POLICY,
          limits: PACK_LIMITS,
          signal: operation.signal,
        },
        {
          execute: async (work) => {
            checkpoint();
            const value = await work(operation.signal, PACK_LIMITS);
            checkpoint();
            return value;
          },
          checkpoint,
          readZip: async (source) => {
            try {
              return {
                ok: true,
                value: await readRestrictedZipCore(source, {
                  signal: operation.signal,
                  limits: PACK_LIMITS,
                  checkpoint,
                  trackIo,
                }),
              };
            } catch (error) {
              if (error instanceof CoreInterrupted) throw error;
              if (
                error instanceof PackToolError &&
                !["OPERATION_CANCELLED", "OPERATION_TIMEOUT"].includes(
                  error.code,
                )
              )
                return { ok: false, issues: [packIssue(error.code)] };
              const code =
                typeof error === "object" && error !== null && "code" in error
                  ? error.code
                  : null;
              if (code === "Z_DATA_ERROR" || code === "Z_BUF_ERROR")
                return { ok: false, issues: [packIssue("ZIP_READ_FAILED")] };
              throw error;
            }
          },
          beforeStructure: (manifest, content) =>
            rawVersionGate(manifest, content, targetProductId),
          parsed: (manifest, content, files) => {
            parsed = { manifest, content, files };
          },
          inspect: async (
            bytes,
            expected,
            _inspectionContext,
            resourceIndex,
          ): Promise<Result<ImageFacts>> => {
            checkpoint();
            const declaration: ImageDeclaration = Object.freeze({
              path: expected.path,
              mediaType: expected.mediaType,
              bytes: expected.bytes,
              sha256: expected.sha256,
              width: expected.width,
              height: expected.height,
            });
            let raw;
            activeMedia = true;
            try {
              raw = await runIsolatedImage(bytes, declaration, context);
            } catch {
              runtimeFailure = "STOP_UNCONFIRMED";
              runtimeIoUnconfirmed = true;
              requestStop(true);
              throw new CoreInterrupted(
                "MEDIA_STOP_UNCONFIRMED",
                "MEDIA_WORKER_FAILED",
              );
            }
            let result;
            try {
              result = parseLaunchResult(Buffer.from(canonicalP1Json(raw)));
            } catch {
              runtimeFailure = "STOP_UNCONFIRMED";
              runtimeIoUnconfirmed = true;
              requestStop(true);
              throw new CoreInterrupted(
                "MEDIA_STOP_UNCONFIRMED",
                "MEDIA_WORKER_FAILED",
              );
            }
            if (!result.ok) {
              runtimeFailure = "STOP_UNCONFIRMED";
              runtimeIoUnconfirmed = true;
              requestStop(true);
              throw new CoreInterrupted(
                "MEDIA_STOP_UNCONFIRMED",
                "MEDIA_WORKER_FAILED",
              );
            }
            media.push({ resourceIndex, result: result.value });
            activeMedia = false;
            if (result.value.outcome === "failed") {
              if (
                result.value.stopped === "unknown" ||
                classifyMediaFailure(result.value.code) === "interrupted"
              ) {
                runtimeFailure = result.value.code;
                if (result.value.stopped === "unknown")
                  runtimeIoUnconfirmed = true;
                requestStop(result.value.stopped === "unknown");
                throw new CoreInterrupted(
                  result.value.stopped === "unknown"
                    ? "MEDIA_STOP_UNCONFIRMED"
                    : "MEDIA_RUNTIME_FAILED",
                  "MEDIA_WORKER_FAILED",
                );
              }
              checkpoint();
              return {
                ok: false,
                issues: [
                  packIssue(
                    result.value.code === "INPUT_LIMIT"
                      ? "MEDIA_LIMIT"
                      : "MEDIA_DECODE_FAILED",
                  ),
                ],
              };
            }
            checkpoint();
            if (
              result.value.facts.mediaType !== declaration.mediaType ||
              result.value.facts.width !== declaration.width ||
              result.value.facts.height !== declaration.height
            )
              return {
                ok: false,
                issues: [packIssue("MEDIA_DECLARATION_MISMATCH")],
              };
            return { ok: true, value: result.value.facts };
          },
          propagate: (error, value, active) => {
            if (error instanceof BackendPolicyRejection) return true;
            if (
              error instanceof PackToolError &&
              !["OPERATION_CANCELLED", "OPERATION_TIMEOUT"].includes(error.code)
            )
              return false;
            const interruption =
              error instanceof CoreInterrupted
                ? error
                : new CoreInterrupted(
                    error instanceof PackToolError &&
                      error.code === "OPERATION_TIMEOUT"
                      ? "OPERATION_TIMEOUT"
                      : error instanceof PackToolError &&
                          error.code === "OPERATION_CANCELLED"
                        ? "OPERATION_CANCELLED"
                        : "BRIDGE_INTERNAL_FAILED",
                    error instanceof PackToolError
                      ? error.code
                      : "VALIDATION_FAILED",
                  );
            value.checks[active] = "failed";
            value.candidateValid = false;
            if (value.issues.length < PACK_LIMITS.issues)
              value.issues.push(packIssue(interruption.p1Code));
            else value.issuesTruncated = true;
            interruption.report = value;
            if (interruption === error) return true;
            throw interruption;
          },
        },
      ),
    );
    sealReport(validated);
    await settleIo();
    if (evidence().completion.relatedIo === "unconfirmed") {
      requestStop();
      return interrupted("RELATED_IO_UNCONFIRMED");
    }
    checkpoint();
    if (!validated.candidateValid) return rejected("P1_REJECTED");
    const frozenParsed = parsed as {
      manifest: QuizPackManifest;
      content: QuizPackContent;
      files: ReadonlyMap<string, Buffer>;
    } | null;
    if (!frozenParsed) throw new CoreInterrupted("BRIDGE_INTERNAL_FAILED");
    try {
      assertPersistenceUnicode(frozenParsed.manifest);
      assertPersistenceUnicode(frozenParsed.content);
      canonicalP1Json(frozenParsed.manifest, "manifest");
      canonicalP1Json(frozenParsed.content, "content");
      for (const declaration of frozenParsed.content.resources) {
        if (
          Buffer.byteLength(canonicalP1Json(declaration), "utf8") >
          EVIDENCE_LIMITS.resourceDeclarationBytes
        )
          throw new BackendPolicyRejection("RESOURCE_DECLARATION_SIZE_LIMIT");
      }
    } catch (error) {
      if (error instanceof BackendPolicyRejection) throw error;
      if (
        error instanceof EvidenceError &&
        ["UNICODE_NUL", "UNICODE_UNPAIRED_SURROGATE"].includes(error.code)
      )
        throw new BackendPolicyRejection(error.code as PolicyCode);
      if (error instanceof P1CanonicalError && error.code === "JSON_SIZE_LIMIT")
        throw new BackendPolicyRejection("CANONICAL_SIZE_LIMIT");
      throw error;
    }
    const rebound = await awaitOperationTask(readMediaRuntimeBinding(context));
    checkpoint();
    if (rebound.outcome === "unavailable") {
      runtimeFailure = rebound.code;
      runtimeIoUnconfirmed = rebound.code === "STOP_UNCONFIRMED";
      requestStop(rebound.code === "STOP_UNCONFIRMED");
      throw new CoreInterrupted(
        rebound.code === "STOP_UNCONFIRMED"
          ? "MEDIA_STOP_UNCONFIRMED"
          : "RUNTIME_IDENTITY_UNAVAILABLE",
      );
    }
    if (canonicalP1Json(rebound.binding) !== canonicalP1Json(runtime.value))
      throw new CoreInterrupted("RUNTIME_IDENTITY_UNAVAILABLE");
    policy = { status: "passed" };
    const accepted = sealCandidateResultEvidence({
      outcome: "accepted",
      evidence: evidence(),
    });
    if (accepted.outcome !== "accepted")
      throw new CoreInterrupted("BRIDGE_INTERNAL_FAILED");
    const candidate = issuePrivateCandidate(accepted, frozenParsed.files);
    checkpoint();
    return Object.freeze({ ...accepted, candidate });
  } catch (error) {
    if (error instanceof BackendPolicyRejection) {
      policy = { status: "rejected", code: error.code };
      if (evidence().report.status !== "sealed")
        report = { status: "not-run", reason: "BACKEND_POLICY_REJECTED" };
      await settleIo();
      if (evidence().completion.relatedIo === "unconfirmed") {
        requestStop();
        return interrupted("RELATED_IO_UNCONFIRMED");
      }
      try {
        checkpoint();
      } catch (stopped) {
        return interrupted(
          stopped instanceof CoreInterrupted
            ? stopped.code
            : "BRIDGE_INTERNAL_FAILED",
        );
      }
      return rejected(error.code);
    }
    requestStop(runtimeFailure === "STOP_UNCONFIRMED");
    if (error instanceof CoreInterrupted && error.report) {
      try {
        sealReport(error.report);
      } catch {
        /* Fixed invalid-report fact already recorded. */
      }
    }
    await settleIo();
    return interrupted(
      runtimeFailure === "STOP_UNCONFIRMED"
        ? "MEDIA_STOP_UNCONFIRMED"
        : evidence().completion.relatedIo === "unconfirmed"
          ? "RELATED_IO_UNCONFIRMED"
          : evidence().report.status === "invalid"
            ? "BRIDGE_REPORT_INVALID"
            : error instanceof CoreInterrupted
              ? error.code
              : "BRIDGE_INTERNAL_FAILED",
    );
  }
}
