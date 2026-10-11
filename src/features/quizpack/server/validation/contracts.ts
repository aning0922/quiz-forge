import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  launchResultSchema,
  mediaRuntimeBindingSchema,
  LAUNCH_FAILURE_CODES,
} from "../media";
import { canonicalP1Json } from "../../v1/canonical";
import { packIdSchema, sha256Schema } from "../../v1/manifest";
import {
  EVIDENCE_LIMITS,
  freezeJson,
  reportEvidenceSchema,
  serializeSealedReport,
} from "./report";
import { assertPersistenceUnicode, EvidenceError } from "./unicode";

export const POLICY_REJECTION_CODES = [
  "UNSUPPORTED_MANIFEST_VERSION",
  "UNSUPPORTED_CONTENT_VERSION",
  "AUTHORED_NOT_SUPPORTED",
  "TARGET_PRODUCT_MISMATCH",
  "UNICODE_NUL",
  "UNICODE_UNPAIRED_SURROGATE",
  "CANONICAL_SIZE_LIMIT",
  "RESOURCE_DECLARATION_SIZE_LIMIT",
] as const;
export const CANDIDATE_REJECTION_CODES = [
  "P1_REJECTED",
  "INPUT_SIZE_LIMIT",
  ...POLICY_REJECTION_CODES,
] as const;
export const CANDIDATE_INTERRUPTION_CODES = [
  "INVALID_INPUT",
  "INVALID_TARGET_PRODUCT",
  "INVALID_CONTEXT",
  "RUNTIME_IDENTITY_UNAVAILABLE",
  "OPERATION_CANCELLED",
  "OPERATION_TIMEOUT",
  "MEDIA_RUNTIME_FAILED",
  "MEDIA_STOP_UNCONFIRMED",
  "RELATED_IO_UNCONFIRMED",
  "BRIDGE_REPORT_INVALID",
  "BRIDGE_EVIDENCE_INVALID",
  "BRIDGE_INTERNAL_FAILED",
] as const;
export type CandidateInterruptionCode =
  (typeof CANDIDATE_INTERRUPTION_CODES)[number];

export const validationIdentitySchema = z
  .strictObject({
    schemaVersion: z.literal("quizpack-validation-identity.v1"),
    validatorVersion: z.literal("1.0.0"),
    policyId: z.literal("quizpack-local-p1.v1"),
    validatorBundleSha256: sha256Schema,
    compatibilityPolicyHash: sha256Schema,
    effectiveLimitsHash: sha256Schema,
    persistencePolicyVersion: z.literal("quizpack-persistence-policy.v1"),
    persistencePolicyHash: sha256Schema,
    reportSchemaVersion: z.literal("quizpack-validation.v1"),
    reportSchemaHash: sha256Schema,
    runtime: mediaRuntimeBindingSchema,
    identitySha256: sha256Schema,
  })
  .superRefine((identity, context) => {
    const { identitySha256, ...payload } = identity;
    const hash = createHash("sha256")
      .update(canonicalP1Json(payload), "utf8")
      .digest("hex");
    if (
      identitySha256 !== hash ||
      identity.validatorBundleSha256 !== identity.runtime.runtimeBundleHash
    )
      context.addIssue({
        code: "custom",
        message: "Invalid validation identity binding.",
      });
  });
export type ValidationIdentity = z.infer<typeof validationIdentitySchema>;

export const mediaFactSchema = z.strictObject({
  resourceIndex: z.number().int().min(0).max(63),
  result: launchResultSchema,
});
export type MediaFact = z.infer<typeof mediaFactSchema>;

const candidateEvidenceSchema = z.strictObject({
  schemaVersion: z.literal("quizpack-candidate-evidence.v1"),
  input: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("snapshotted"),
      archiveSha256: sha256Schema,
      archiveBytes: z
        .number()
        .int()
        .nonnegative()
        .max(32 * 1024 * 1024),
      targetProductId: packIdSchema,
    }),
    z.strictObject({
      status: z.literal("unavailable"),
      code: z.enum(["INVALID_INPUT", "INVALID_TARGET_PRODUCT"]),
    }),
  ]),
  identity: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("bound"),
      value: validationIdentitySchema,
    }),
    z.strictObject({
      status: z.literal("unavailable"),
      code: z.enum(["INVALID_CONTEXT", "RUNTIME_IDENTITY_UNAVAILABLE"]),
    }),
  ]),
  report: reportEvidenceSchema,
  policy: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("not-run") }),
    z.strictObject({ status: z.literal("passed") }),
    z.strictObject({
      status: z.literal("rejected"),
      code: z.enum(POLICY_REJECTION_CODES),
    }),
  ]),
  media: z.array(mediaFactSchema).max(EVIDENCE_LIMITS.mediaPerAttempt),
  completion: z.strictObject({
    mediaStopped: z.enum(["not-started", "confirmed", "unknown"]),
    relatedIo: z.enum(["settled", "unconfirmed"]),
    maintenanceRequired: z.boolean(),
  }),
  runtimeFailure: z.enum(LAUNCH_FAILURE_CODES).nullable(),
});
export type CandidateEvidence = z.infer<typeof candidateEvidenceSchema>;

/** Candidate handle deliberately does not enter any structural JSON Schema. */
export const candidateResultEvidenceSchema = z
  .discriminatedUnion("outcome", [
    z.strictObject({
      outcome: z.literal("accepted"),
      evidence: candidateEvidenceSchema,
    }),
    z.strictObject({
      outcome: z.literal("rejected"),
      code: z.enum(CANDIDATE_REJECTION_CODES),
      evidence: candidateEvidenceSchema,
    }),
    z.strictObject({
      outcome: z.literal("interrupted"),
      code: z.enum(CANDIDATE_INTERRUPTION_CODES),
      evidence: candidateEvidenceSchema,
    }),
  ])
  .superRefine((result, context) => {
    const evidence = result.evidence;
    const invalid = () =>
      context.addIssue({
        code: "custom",
        message: "Inconsistent candidate result evidence.",
      });
    const mediaStopped =
      evidence.runtimeFailure === "STOP_UNCONFIRMED" ||
      evidence.media.some((fact) => fact.result.stopped === "unknown")
        ? "unknown"
        : evidence.media.some((fact) => fact.result.stopped === "confirmed")
          ? "confirmed"
          : "not-started";
    if (evidence.completion.mediaStopped !== mediaStopped) invalid();
    const needsMaintenance =
      mediaStopped === "unknown" ||
      evidence.completion.relatedIo === "unconfirmed";
    if (evidence.completion.maintenanceRequired !== needsMaintenance) invalid();
    if (
      new Set(evidence.media.map((fact) => fact.resourceIndex)).size !==
        evidence.media.length ||
      new Set(evidence.media.map((fact) => fact.result.runId)).size !==
        evidence.media.length
    )
      invalid();
    if (evidence.report.status === "sealed") {
      try {
        serializeSealedReport(evidence.report);
      } catch {
        invalid();
      }
      if (
        evidence.input.status === "snapshotted" &&
        (evidence.report.value.targetProductId !==
          evidence.input.targetProductId ||
          evidence.report.value.archiveSha256 !== evidence.input.archiveSha256)
      )
        invalid();
      if (
        evidence.identity.status === "bound" &&
        (evidence.report.value.compatibilityPolicyHash !==
          evidence.identity.value.compatibilityPolicyHash ||
          evidence.report.value.effectiveLimitsHash !==
            evidence.identity.value.effectiveLimitsHash)
      )
        invalid();
    }
    if (result.outcome !== "interrupted") {
      if (
        evidence.input.status !== "snapshotted" ||
        evidence.identity.status !== "bound" ||
        needsMaintenance ||
        evidence.runtimeFailure !== null ||
        evidence.media.some(
          (fact) =>
            fact.result.outcome === "failed" &&
            !["DECODE_REJECTED", "INPUT_LIMIT"].includes(fact.result.code),
        )
      )
        invalid();
    }
    if (result.outcome === "accepted") {
      if (
        evidence.report.status !== "sealed" ||
        !evidence.report.value.candidateValid ||
        evidence.policy.status !== "passed" ||
        evidence.media.some((fact) => fact.result.outcome !== "decoded")
      )
        invalid();
    } else if (result.outcome === "rejected") {
      if (evidence.policy.status === "rejected") {
        if (result.code !== evidence.policy.code) invalid();
        if (
          evidence.report.status === "not-run" &&
          evidence.report.reason !== "BACKEND_POLICY_REJECTED"
        )
          invalid();
      } else if (result.code === "P1_REJECTED") {
        if (
          evidence.report.status !== "sealed" ||
          evidence.report.value.candidateValid
        )
          invalid();
      } else if (result.code !== "INPUT_SIZE_LIMIT") invalid();
      if (evidence.report.status === "invalid") invalid();
    }
    if (evidence.report.status === "not-run") {
      if (
        evidence.report.reason === "IDENTITY_UNAVAILABLE" &&
        evidence.identity.status !== "unavailable"
      )
        invalid();
      if (
        evidence.report.reason === "BACKEND_POLICY_REJECTED" &&
        evidence.policy.status !== "rejected"
      )
        invalid();
      if (
        evidence.report.reason === "OPERATION_INTERRUPTED_BEFORE_P1" &&
        result.outcome !== "interrupted"
      )
        invalid();
    }
  });
export type CandidateResultEvidence = z.infer<
  typeof candidateResultEvidenceSchema
>;

export const evidenceEnvelopeSchema = z
  .strictObject({
    schemaVersion: z.literal("quizpack-evidence-envelope.v1"),
    attempts: z
      .array(
        z.strictObject({
          attempt: z.number().int().min(1).max(3),
          result: candidateResultEvidenceSchema,
        }),
      )
      .min(1)
      .max(EVIDENCE_LIMITS.attempts),
  })
  .superRefine((envelope, context) => {
    const ids = envelope.attempts.map((attempt) => attempt.attempt);
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id, index) => index > 0 && id <= ids[index - 1]!)
    )
      context.addIssue({
        code: "custom",
        message: "Invalid attempt sequence.",
      });
    const inputs = envelope.attempts.flatMap(({ result }) =>
      result.evidence.input.status === "snapshotted"
        ? [canonicalP1Json(result.evidence.input)]
        : [],
    );
    const identities = envelope.attempts.flatMap(({ result }) =>
      result.evidence.identity.status === "bound"
        ? [result.evidence.identity.value.identitySha256]
        : [],
    );
    if (new Set(inputs).size > 1 || new Set(identities).size > 1)
      context.addIssue({
        code: "custom",
        message: "Attempt evidence binding mismatch.",
      });
    if (
      envelope.attempts.reduce(
        (count, attempt) => count + attempt.result.evidence.media.length,
        0,
      ) > EVIDENCE_LIMITS.mediaTotal
    )
      context.addIssue({ code: "custom", message: "Too many media facts." });
  });
export type EvidenceEnvelope = z.infer<typeof evidenceEnvelopeSchema>;

function enforceBudgets(envelope: EvidenceEnvelope): void {
  let reportBytes = 0;
  const metadata = {
    ...envelope,
    attempts: envelope.attempts.map(({ attempt, result }) => {
      const report = result.evidence.report;
      if (report.status === "sealed") reportBytes += report.canonicalBytes;
      return {
        attempt,
        result: {
          ...result,
          evidence: {
            ...result.evidence,
            report:
              report.status === "sealed" ? { ...report, value: null } : report,
          },
        },
      };
    }),
  };
  if (reportBytes > EVIDENCE_LIMITS.reportPayloadBytes)
    throw new EvidenceError("EVIDENCE_REPORT_PAYLOAD_LIMIT");
  if (
    Buffer.byteLength(canonicalP1Json(metadata), "utf8") >
    EVIDENCE_LIMITS.metadataBytes
  )
    throw new EvidenceError("EVIDENCE_METADATA_SIZE_LIMIT");
  if (
    Buffer.byteLength(canonicalP1Json(envelope), "utf8") >
    EVIDENCE_LIMITS.envelopeBytes
  )
    throw new EvidenceError("EVIDENCE_ENVELOPE_SIZE_LIMIT");
}

export function sealEvidenceEnvelope(input: unknown): EvidenceEnvelope {
  let parsed: ReturnType<typeof evidenceEnvelopeSchema.safeParse>;
  try {
    parsed = evidenceEnvelopeSchema.safeParse(
      JSON.parse(canonicalP1Json(input)),
    );
  } catch {
    throw new EvidenceError("EVIDENCE_SCHEMA_INVALID");
  }
  if (!parsed.success) throw new EvidenceError("EVIDENCE_SCHEMA_INVALID");
  assertPersistenceUnicode(parsed.data);
  enforceBudgets(parsed.data);
  return freezeJson(parsed.data);
}

export function sealCandidateResultEvidence(
  input: unknown,
): CandidateResultEvidence {
  return sealEvidenceEnvelope({
    schemaVersion: "quizpack-evidence-envelope.v1",
    attempts: [{ attempt: 1, result: input }],
  }).attempts[0]!.result;
}
