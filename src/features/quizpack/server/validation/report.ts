import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalP1Json } from "../../v1/canonical";
import { PACK_LIMITS } from "../../v1/limits";
import {
  SUPPORTED_POLICY_ID,
  SUPPORTED_REPORT_VERSION,
  SUPPORTED_VALIDATOR_VERSION,
} from "../../package/compatibility";
import { packIdSchema, sha256Schema } from "../../v1/manifest";
import { assertPersistenceUnicode, EvidenceError } from "./unicode";

export const EVIDENCE_LIMITS = Object.freeze({
  resourceDeclarationBytes: 64 * 1024,
  reportBytes: 256 * 1024,
  reportPayloadBytes: 768 * 1024,
  metadataBytes: 64 * 1024,
  envelopeBytes: 1024 * 1024,
  attempts: 3,
  mediaPerAttempt: 64,
  mediaTotal: 192,
});

/** Closed registry for final P1 reports; arbitrary PackToolError codes cannot pass. */
export const P1_ISSUE_CODES = [
  "INVALID_TARGET_PRODUCT",
  "INVALID_LIMITS",
  "INVALID_COMPATIBILITY_POLICY",
  "INPUT_INVALID_BYTES",
  "INPUT_SIZE_LIMIT",
  "OPERATION_CANCELLED",
  "OPERATION_TIMEOUT",
  "ZIP_INVALID_STRUCTURE",
  "ZIP_UNSUPPORTED_PROFILE",
  "ZIP_INVALID_PATH",
  "ZIP_DUPLICATE_PATH",
  "ZIP_ENTRY_LIMIT",
  "ZIP_RESOURCE_LIMIT",
  "ZIP_FILE_SIZE_LIMIT",
  "ZIP_TOTAL_SIZE_LIMIT",
  "ZIP_COMPRESSION_RATIO_LIMIT",
  "ZIP_ACTUAL_SIZE_LIMIT",
  "ZIP_DEFLATE_TRAILING_BYTES",
  "ZIP_SIZE_MISMATCH",
  "ZIP_CRC_MISMATCH",
  "ZIP_READ_FAILED",
  "JSON_SIZE_LIMIT",
  "JSON_DEPTH_LIMIT",
  "JSON_ENCODING",
  "JSON_SYNTAX",
  "JSON_INVALID_VALUE",
  "JSON_DUPLICATE_KEY",
  "JSON_FORBIDDEN_KEY",
  "JSON_CYCLE",
  "MISSING_REQUIRED_JSON",
  "MANIFEST_STRUCTURE",
  "CONTENT_STRUCTURE",
  "CONTENT_LIMIT",
  "DUPLICATE_MANIFEST_PATH",
  "MANIFEST_FILE_MISSING",
  "FILE_INTEGRITY_MISMATCH",
  "UNDECLARED_ARCHIVE_FILE",
  "MEDIA_FILE_MISSING",
  "MEDIA_DECLARATION_INVALID",
  "MEDIA_LIMIT",
  "MEDIA_INTEGRITY_MISMATCH",
  "MEDIA_FORMAT_MISMATCH",
  "MEDIA_ANIMATED",
  "MEDIA_CANCELLED",
  "MEDIA_TIMEOUT",
  "MEDIA_WORKER_FAILED",
  "MEDIA_DECODE_FAILED",
  "MEDIA_DECLARATION_MISMATCH",
  "TARGET_PRODUCT_MISMATCH",
  "CONTENT_DECLARATION_MISMATCH",
  "DUPLICATE_ID",
  "FOREIGN_OWNER",
  "DEFINITION_VERSION_MISMATCH",
  "MISSING_REFERENCE",
  "REFERENCE_VERSION_OR_OWNER_MISMATCH",
  "DUPLICATE_DIMENSION",
  "INCOMPLETE_DIMENSION_VECTOR",
  "DUPLICATE_OPTION_ID",
  "INVALID_NORMALIZATION_BOUNDS",
  "DUPLICATE_RESULT_REFERENCE",
  "INCOMPLETE_RESULT_COVERAGE",
  "INVALID_RESULT_RANGE",
  "RESOURCE_PURPOSE_MISMATCH",
  "OPTION_QUESTION_MISMATCH",
  "DUPLICATE_WITNESS_ANSWER",
  "INCOMPLETE_WITNESS",
  "DUPLICATE_COMPONENT",
  "COMPONENT_VERSION_MISMATCH",
  "COMPONENT_DECLARATION_MISMATCH",
  "COMPONENT_STATE_MISMATCH",
  "DUPLICATE_RESOURCE_REFERENCE",
  "UNUSED_REPORT_TEMPLATE",
  "UNUSED_COMPONENT",
  "CONTENT_FILE_DECLARATION",
  "FILE_MEDIA_TYPE_MISMATCH",
  "MISSING_CONTENT_FILE",
  "RESOURCE_PATH_MISMATCH",
  "DUPLICATE_RESOURCE_PATH",
  "RESOURCE_FILE_DECLARATION_MISMATCH",
  "IMAGE_PIXEL_LIMIT",
  "UNUSED_RESOURCE",
  "UNDECLARED_RESOURCE_FILE",
  "UNSUPPORTED_CONTENT_SCHEMA",
  "UNSUPPORTED_ENGINE",
  "UNSUPPORTED_COMPONENT",
  "VALIDATION_FAILED",
] as const;

export const P1_ISSUE_MESSAGES = [
  "QuizPack operation rejected.",
  "Invalid validation limits.",
  "Image does not satisfy the static media validation policy.",
  "Value does not satisfy the quizpack.v1 manifest contract.",
  "Value does not satisfy the quizpack-content.v1 contract.",
  "Both declarations must belong to the target Product.",
  "Manifest, content and rule contracts must agree.",
  "Definition IDs must be unique in their namespace.",
  "Every definition must belong to this Product.",
  "Definition must use its pinned domain version.",
  "Reference must resolve in its declared namespace.",
  "Reference must match the exact Product and version.",
  "A dimension can occur only once in each vector.",
  "The vector must include every declared dimension exactly once.",
  "Option IDs must be unique across questions.",
  "Normalization bounds must match the nonconstant attainable sum extrema.",
  "Each result must occur once in this declaration.",
  "Declaration must cover every result exactly once.",
  "Result ranges must be ordered inclusive normalized bounds.",
  "Result portraits require portrait resources.",
  "Witness option must belong to its referenced question.",
  "Witness must answer each question once.",
  "Witness must contain one answer for every question.",
  "Manifest component IDs must be unique.",
  "Component must use the pinned component version.",
  "Component must match a manifest contract exactly.",
  "Component contract must support its declared page state.",
  "Layout resource references must be unique.",
  "Cover must use a neutral cover or decoration resource.",
  "Baseline report requires the P1 report component contract.",
  "Each report template must be referenced by a result.",
  "Manifest must list only used component contracts.",
  "Manifest file paths must be unique.",
  "Content file must have its JSON type and byte limit.",
  "Asset extension and declared media type must agree.",
  "Manifest must declare content.json exactly once.",
  "Resource path must match its ID and format.",
  "Resources must use distinct file paths.",
  "Resource must match its manifest file declaration exactly.",
  "Declared image exceeds the pixel limit.",
  "Each resource must have a declared use.",
  "Every asset file must be declared as a Product resource.",
  "Content schema is not supported by the trusted policy.",
  "Engine contract is not supported by the trusted policy.",
  "Component contract is not supported by the trusted policy.",
] as const;

export const P1_UNVERIFIED = [
  "deterministic-scoring-and-witness-reachability",
  "resource-license-and-approval-claims",
  "human-content-and-visual-review",
  "runtime-component-rendering",
  "database-import-and-publication",
] as const;

const checkState = z.enum(["passed", "failed", "not-run"]);
export const strictP1ReportSchema = z
  .strictObject({
    schemaVersion: z.literal("quizpack-validation.v1"),
    archiveSha256: sha256Schema.optional(),
    manifestSha256: sha256Schema.optional(),
    contentSha256: sha256Schema.optional(),
    targetProductId: z.union([packIdSchema, z.literal("")]),
    validatorVersion: z.literal("1.0.0"),
    policyId: z.literal("quizpack-local-p1.v1"),
    compatibilityPolicyHash: sha256Schema,
    effectiveLimitsHash: sha256Schema,
    checks: z.strictObject({
      container: checkState,
      structure: checkState,
      references: checkState,
      integrity: checkState,
      media: checkState,
      compatibility: checkState,
    }),
    candidateValid: z.boolean(),
    importable: z.literal(false),
    publishable: z.literal(false),
    issues: z
      .array(
        z.strictObject({
          code: z.enum(P1_ISSUE_CODES),
          path: z
            .array(
              z.union([
                z
                  .string()
                  .max(20)
                  .regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
                // Rejected raw arrays can exceed valid content's item limits.
                z
                  .number()
                  .int()
                  .min(0)
                  .max(
                    Math.max(
                      PACK_LIMITS.contentBytes,
                      PACK_LIMITS.manifestBytes,
                    ),
                  ),
              ]),
            )
            .max(8),
          message: z.enum(P1_ISSUE_MESSAGES),
        }),
      )
      .max(100),
    issuesTruncated: z.boolean(),
    unverified: z.tuple(
      P1_UNVERIFIED.map((value) => z.literal(value)) as [
        z.ZodLiteral<(typeof P1_UNVERIFIED)[0]>,
        z.ZodLiteral<(typeof P1_UNVERIFIED)[1]>,
        z.ZodLiteral<(typeof P1_UNVERIFIED)[2]>,
        z.ZodLiteral<(typeof P1_UNVERIFIED)[3]>,
        z.ZodLiteral<(typeof P1_UNVERIFIED)[4]>,
      ],
    ),
  })
  .superRefine((report, context) => {
    if (
      report.candidateValid &&
      (Object.values(report.checks).some((value) => value !== "passed") ||
        report.issues.length !== 0 ||
        report.issuesTruncated ||
        !report.archiveSha256 ||
        !report.manifestSha256 ||
        !report.contentSha256)
    )
      context.addIssue({
        code: "custom",
        message: "Inconsistent P1 candidate evidence.",
      });
    if (report.issuesTruncated && report.issues.length !== 100)
      context.addIssue({
        code: "custom",
        message: "Inconsistent issue limit evidence.",
      });
  });
export type StrictP1Report = z.infer<typeof strictP1ReportSchema>;

/** v2 consumes the content module's truncation marker; it is not a business issue. */
export const SUPPORTED_ISSUE_CODES = [
  ...P1_ISSUE_CODES,
  "CONTENT_INPUT_LIMIT_EXCEEDED",
  "CONTENT_INPUT_REJECTED",
  "DUPLICATE_PRESENTATION_REFERENCE",
  "DUPLICATE_SECTION_ID",
  "NONCONTIGUOUS_SECTION_ORDER",
  "PRESENTATION_REFERENCE_COVERAGE",
  "PRESENTATION_REFERENCE_MISMATCH",
  "QUESTION_FRAME_COVERAGE",
  "QUESTION_FRAME_ORDER_OR_REFERENCE",
  "UNKNOWN_SECTION_REFERENCE",
  "UNUSED_SECTION",
] as const;
export const SUPPORTED_ISSUE_MESSAGES = [
  ...P1_ISSUE_MESSAGES,
  "Content must be bounded ordinary JSON.",
  "Only explicitly supported content versions are accepted.",
  "Value does not satisfy its declared content contract.",
  "Content must use the exact declared presentation reference graph.",
  "Manifest and content must match the expected content schema version.",
] as const;
export const strictSupportedReportSchema = z
  .strictObject({
    ...strictP1ReportSchema.shape,
    schemaVersion: z.literal(SUPPORTED_REPORT_VERSION),
    validatorVersion: z.literal(SUPPORTED_VALIDATOR_VERSION),
    policyId: z.literal(SUPPORTED_POLICY_ID),
    issues: z
      .array(
        strictP1ReportSchema.shape.issues.element.extend({
          code: z.enum(SUPPORTED_ISSUE_CODES),
          message: z.enum(SUPPORTED_ISSUE_MESSAGES),
        }),
      )
      .max(100),
  })
  .superRefine((report, context) => {
    if (
      report.candidateValid &&
      (Object.values(report.checks).some((value) => value !== "passed") ||
        report.issues.length !== 0 ||
        report.issuesTruncated ||
        !report.archiveSha256 ||
        !report.manifestSha256 ||
        !report.contentSha256)
    )
      context.addIssue({
        code: "custom",
        message: "Inconsistent supported candidate evidence.",
      });
  });
export type StrictSupportedReport = z.infer<typeof strictSupportedReportSchema>;
export const supportedReportValueSchema = z.union([
  strictP1ReportSchema,
  strictSupportedReportSchema,
]);

export const sealedReportSchema = z.strictObject({
  status: z.literal("sealed"),
  value: supportedReportValueSchema,
  canonicalBytes: z.number().int().positive().max(EVIDENCE_LIMITS.reportBytes),
  sha256: sha256Schema,
});
export type SealedReport = z.infer<typeof sealedReportSchema>;

export const reportEvidenceSchema = z.discriminatedUnion("status", [
  sealedReportSchema,
  z.strictObject({
    status: z.literal("not-run"),
    reason: z.enum([
      "INPUT_REJECTED",
      "IDENTITY_UNAVAILABLE",
      "BACKEND_POLICY_REJECTED",
      "OPERATION_INTERRUPTED_BEFORE_P1",
    ]),
  }),
  z.strictObject({
    status: z.literal("invalid"),
    code: z.enum(["REPORT_SCHEMA_INVALID", "REPORT_SIZE_LIMIT"]),
  }),
]);
export type ReportEvidence = z.infer<typeof reportEvidenceSchema>;

export function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

/** Copies, checks, hashes and freezes the complete final report once. */
function sealStrictReport<T extends StrictP1Report | StrictSupportedReport>(
  input: unknown,
  schema: z.ZodType<T>,
): { status: "sealed"; value: T; canonicalBytes: number; sha256: string } {
  let ordinary: unknown;
  try {
    ordinary = JSON.parse(canonicalP1Json(input));
  } catch {
    throw new EvidenceError("REPORT_SCHEMA_INVALID");
  }
  const parsed = schema.safeParse(ordinary);
  if (!parsed.success) throw new EvidenceError("REPORT_SCHEMA_INVALID");
  assertPersistenceUnicode(parsed.data);
  const text = canonicalP1Json(parsed.data);
  const canonicalBytes = Buffer.byteLength(text, "utf8");
  if (canonicalBytes > EVIDENCE_LIMITS.reportBytes)
    throw new EvidenceError("REPORT_SIZE_LIMIT");
  return freezeJson({
    status: "sealed" as const,
    value: parsed.data,
    canonicalBytes,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
  });
}

/** Legacy P1 retains its strict report type and byte format. */
export function sealP1Report(input: unknown) {
  return sealStrictReport(input, strictP1ReportSchema);
}
export function sealSupportedReport(input: unknown) {
  return sealStrictReport(input, strictSupportedReportSchema);
}

/** No stored canonicalText: serialization is recreated from the frozen value. */
export function serializeSealedReport(input: SealedReport): string {
  const parsed = sealedReportSchema.safeParse(input);
  if (!parsed.success) throw new EvidenceError("REPORT_SCHEMA_INVALID");
  const text = canonicalP1Json(parsed.data.value);
  if (
    Buffer.byteLength(text, "utf8") !== parsed.data.canonicalBytes ||
    createHash("sha256").update(text, "utf8").digest("hex") !==
      parsed.data.sha256
  )
    throw new EvidenceError("REPORT_BINDING_MISMATCH");
  return text;
}

export const REPORT_SCHEMA_HASH = createHash("sha256")
  .update(
    canonicalP1Json({
      // Zod's trusted export contains non-enumerable implementation metadata.
      schema: JSON.parse(JSON.stringify(z.toJSONSchema(strictP1ReportSchema))),
      refinements: [
        "candidateValid-requires-all-checks-passed-no-issues-and-three-byte-hashes",
        "issuesTruncated-requires-one-hundred-retained-issues",
      ],
    }),
    "utf8",
  )
  .digest("hex");

export const SUPPORTED_REPORT_SCHEMA_HASH = createHash("sha256")
  .update(
    canonicalP1Json({
      schema: JSON.parse(
        JSON.stringify(z.toJSONSchema(strictSupportedReportSchema)),
      ),
      refinements: [
        "candidateValid-requires-all-checks-passed-no-issues-and-three-byte-hashes",
        "issuesTruncated-preserves-upstream-content-or-package-or-collector-truncation",
      ],
    }),
    "utf8",
  )
  .digest("hex");
