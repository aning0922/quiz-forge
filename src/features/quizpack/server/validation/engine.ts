import {
  createValidationOperationScope,
  ValidationInterrupted as CoreInterrupted,
} from "./operation-scope";
import { supportedRuntimeIdentity, readTrustedBinding } from "./identity";
import "server-only";
import { createHash } from "node:crypto";
import { types } from "node:util";
import {
  classifyMediaFailure,
  parseLaunchResult,
  readMediaOperationState,
  runIsolatedImage,
  type ImageDeclaration,
  type MediaOperationContext,
} from "../media";
import type { Result, ImageFacts } from "../../v1/api";
import type {
  SupportedParsedPack,
  PackageValidationReport,
} from "../../package/api";
import { canonicalP1Json, P1CanonicalError } from "../../v1/canonical";
import { PACK_LIMITS } from "../../v1/limits";
import { packIdSchema } from "../../v1/manifest";
import { validateSupportedQuizPackCore } from "../../package/validate-core";
import { isContentSchemaVersion } from "../../package/manifest";
import { PackToolError, packIssue, readRestrictedZipCore } from "../../v1/zip";
import {
  sealCandidateResultEvidence,
  type CandidateEvidence,
  type CandidateInterruptionCode,
  type MediaFact,
  type POLICY_REJECTION_CODES,
  type CANDIDATE_REJECTION_CODES,
} from "./contracts";
import {
  issuePrivateCandidate,
  type CandidateResult,
} from "./private-candidate";
import { EVIDENCE_LIMITS, sealSupportedReport } from "./report";
import { assertPersistenceUnicode, EvidenceError } from "./unicode";

const hash = (input: Uint8Array | string) =>
  createHash("sha256").update(input).digest("hex");
type PolicyCode = (typeof POLICY_REJECTION_CODES)[number];
type RejectionCode = (typeof CANDIDATE_REJECTION_CODES)[number];
class BackendPolicyRejection extends Error {
  constructor(readonly code: PolicyCode) {
    super("Backend validation policy rejected.");
  }
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
  // Supported but malformed content receives a real structure report. Unknown dispatch is backend policy.
  if (
    rawManifest?.schemaVersion !== undefined &&
    rawManifest.schemaVersion !== "quizpack.v1"
  )
    throw new BackendPolicyRejection("UNSUPPORTED_MANIFEST_VERSION");
  if (
    rawContent?.schemaVersion !== undefined &&
    !isContentSchemaVersion(rawContent.schemaVersion)
  )
    throw new BackendPolicyRejection("UNSUPPORTED_CONTENT_VERSION");
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
  const scope = createValidationOperationScope(context);
  const media: MediaFact[] = [];
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
  const parsed: {
    value: {
      pack: SupportedParsedPack;
      files: ReadonlyMap<string, Buffer>;
    } | null;
  } = { value: null };
  const { requestStop, trackIo, awaitOperationTask, settleIo } = scope;
  const checkpoint = (): void => {
    try {
      scope.checkpoint();
    } catch (error) {
      if (
        error instanceof CoreInterrupted &&
        error.code === "INVALID_CONTEXT"
      ) {
        identity = { status: "unavailable", code: "INVALID_CONTEXT" };
        if (report.status !== "sealed")
          report = { status: "not-run", reason: "IDENTITY_UNAVAILABLE" };
      }
      throw error;
    }
  };
  const evidence = (): CandidateEvidence => ({
    schemaVersion: "quizpack-candidate-evidence.v1",
    input: inputEvidence,
    identity,
    report,
    policy,
    media,
    completion: scope.completion(media),
    runtimeFailure: scope.runtimeFailure,
  });
  const interrupted = (code: CandidateInterruptionCode): CandidateResult => {
    requestStop(scope.runtimeFailure === "STOP_UNCONFIRMED");
    const current = evidence();
    const sealed = sealCandidateResultEvidence({
      outcome: "interrupted",
      code:
        current.completion.mediaStopped === "unknown"
          ? "MEDIA_STOP_UNCONFIRMED"
          : current.completion.relatedIo === "unconfirmed"
            ? "RELATED_IO_UNCONFIRMED"
            : code,
      evidence: current,
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
  const sealReport = (value: PackageValidationReport): void => {
    try {
      report = sealSupportedReport(value);
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
  const readBinding = () => readTrustedBinding(scope);
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
    report = { status: "not-run", reason: "IDENTITY_UNAVAILABLE" };
    const runtime = await readBinding();
    identity = { status: "bound", value: supportedRuntimeIdentity(runtime) };
    const operation = readMediaOperationState(context);
    report = { status: "not-run", reason: "OPERATION_INTERRUPTED_BEFORE_P1" };
    const validated = await awaitOperationTask(
      validateSupportedQuizPackCore(
        (async function* () {
          yield archive!;
        })(),
        {
          targetProductId,
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
          parsed: (pack, files) => {
            parsed.value = { pack, files };
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
            scope.activeMedia = true;
            try {
              raw = await runIsolatedImage(bytes, declaration, context);
            } catch {
              scope.runtimeFailure = "STOP_UNCONFIRMED";
              scope.runtimeIoUnconfirmed = true;
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
              scope.runtimeFailure = "STOP_UNCONFIRMED";
              scope.runtimeIoUnconfirmed = true;
              requestStop(true);
              throw new CoreInterrupted(
                "MEDIA_STOP_UNCONFIRMED",
                "MEDIA_WORKER_FAILED",
              );
            }
            if (!result.ok) {
              scope.runtimeFailure = "STOP_UNCONFIRMED";
              scope.runtimeIoUnconfirmed = true;
              requestStop(true);
              throw new CoreInterrupted(
                "MEDIA_STOP_UNCONFIRMED",
                "MEDIA_WORKER_FAILED",
              );
            }
            media.push({ resourceIndex, result: result.value });
            scope.activeMedia = false;
            if (result.value.outcome === "failed") {
              if (
                result.value.stopped === "unknown" ||
                classifyMediaFailure(result.value.code) === "interrupted"
              ) {
                scope.runtimeFailure = result.value.code;
                if (result.value.stopped === "unknown")
                  scope.runtimeIoUnconfirmed = true;
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
        { kind: "backend-matrix" },
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
    const frozenParsed = parsed.value;
    if (!frozenParsed) throw new CoreInterrupted("BRIDGE_INTERNAL_FAILED");
    try {
      assertPersistenceUnicode(frozenParsed.pack.manifest);
      assertPersistenceUnicode(frozenParsed.pack.content);
      canonicalP1Json(frozenParsed.pack.manifest, "manifest");
      canonicalP1Json(frozenParsed.pack.content, "content");
      for (const declaration of frozenParsed.pack.content.resources) {
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
    const rebound = await readBinding();
    if (canonicalP1Json(rebound) !== canonicalP1Json(runtime))
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
    requestStop(scope.runtimeFailure === "STOP_UNCONFIRMED");
    if (error instanceof CoreInterrupted && error.report) {
      try {
        sealReport(error.report);
      } catch {
        /* Fixed invalid-report fact already recorded. */
      }
    }
    await settleIo();
    return interrupted(
      scope.runtimeFailure === "STOP_UNCONFIRMED"
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
