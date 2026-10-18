import { z } from "zod";
import {
  assessmentIdSchema,
  sha256Schema,
} from "@/lib/assessment-contract/primitives";
import { importIdSchema } from "@/features/quizpack/import/contracts";
import {
  INTERNAL_VERSION_LIMITS as L,
  revisionTargetSchema,
  baselineIdentitySchema,
  rendererIdentitySchema,
  engineIdentitySchema,
  internalReviewFactsSchema,
  internalVersionSnapshotSchema,
  internalRendererCapabilitySchema,
  withinInternalBytes,
  internalCanonicalText,
  hashInternalText,
  sameRevisionTarget,
} from "./identity-contracts";
export * from "./identity-contracts";
const id = assessmentIdSchema.refine((v) => !/[\r\n]/.test(v));
const sha = sha256Schema.length(64);
const uuid = importIdSchema.length(36);
const moment = z.iso.datetime({ precision: 3 });
export const recordBaselineInputSchema = z.strictObject({
  schemaVersion: z.literal("quizforge.review-record.v1"),
  idempotencyKey: uuid,
  target: revisionTargetSchema,
  baseline: baselineIdentitySchema,
});
export const recordBaselineBindingSchema = z.strictObject({
  productId: id,
  ...recordBaselineInputSchema.shape,
});
export const sealInternalVersionInputSchema = z.strictObject({
  schemaVersion: z.literal("quizforge.internal-version-seal.v1"),
  idempotencyKey: uuid,
  target: revisionTargetSchema,
  reviewId: uuid,
  reviewSha256: sha,
  renderer: rendererIdentitySchema,
  engine: engineIdentitySchema,
});
export const sealInternalVersionBindingSchema = z.strictObject({
  productId: id,
  ...sealInternalVersionInputSchema.shape,
});
export type RecordBaselineBinding = z.infer<typeof recordBaselineBindingSchema>;
export type SealInternalVersionBinding = z.infer<
  typeof sealInternalVersionBindingSchema
>;
export type RecordBaselineInput = z.infer<typeof recordBaselineInputSchema>;
export type SealInternalVersionInput = z.infer<
  typeof sealInternalVersionInputSchema
>;
/** Complete new-operation binding, including the key; old protocols are unchanged. */
export const recordBaselineFingerprintText = (value: unknown) =>
  internalCanonicalText(
    recordBaselineBindingSchema.parse(value),
    L.requestBytes,
  );
export const sealInternalVersionFingerprintText = (value: unknown) =>
  internalCanonicalText(
    sealInternalVersionBindingSchema.parse(value),
    L.requestBytes,
  );
export const recordBaselineFingerprint = (value: unknown) =>
  hashInternalText(recordBaselineFingerprintText(value));
export const sealInternalVersionFingerprint = (value: unknown) =>
  hashInternalText(sealInternalVersionFingerprintText(value));
export const sameRecordBaselineBinding = (a: unknown, b: unknown) =>
  recordBaselineFingerprintText(a) === recordBaselineFingerprintText(b);
export const sameSealInternalVersionBinding = (a: unknown, b: unknown) =>
  sealInternalVersionFingerprintText(a) ===
  sealInternalVersionFingerprintText(b);
const equal = (a: unknown, b: unknown) =>
  internalCanonicalText(a) === internalCanonicalText(b);
export const internalReviewReceiptSchema = z
  .strictObject({
    id: uuid,
    binding: recordBaselineBindingSchema,
    fingerprint: sha,
    facts: internalReviewFactsSchema,
    reviewSha256: sha,
    recordedBy: uuid,
    recordedAt: moment,
  })
  .refine(
    (v) =>
      v.binding.productId === v.facts.productId &&
      sameRevisionTarget(v.binding.target, v.facts.target) &&
      equal(v.binding.baseline, v.facts.baseline),
  );
export const internalVersionReceiptSchema = z.strictObject({
  id: uuid,
  slot: z.number().int().min(1).max(100),
  binding: sealInternalVersionBindingSchema,
  fingerprint: sha,
  purpose: z.literal("internal-test"),
  publicationApproved: z.literal(false),
  snapshotSha256: sha,
  createdBy: uuid,
  createdAt: moment,
});
export type InternalReviewReceipt = z.infer<typeof internalReviewReceiptSchema>;
export type InternalVersionReceipt = z.infer<
  typeof internalVersionReceiptSchema
>;
export const recordBaselineResultSchema = z.strictObject({
  created: z.boolean(),
  review: internalReviewReceiptSchema,
});
export const sealInternalVersionResultSchema = z.strictObject({
  created: z.boolean(),
  version: internalVersionReceiptSchema,
});
const reviewObservation = {
  binding: recordBaselineBindingSchema,
  fingerprint: sha,
  observedCurrentRevision: z.number().int().min(1).max(100),
};
export const internalReviewResolutionSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("recorded"),
      binding: recordBaselineBindingSchema,
      fingerprint: sha,
      review: internalReviewReceiptSchema,
    }),
    z.strictObject({ kind: z.literal("unresolved"), ...reviewObservation }),
    z.strictObject({
      kind: z.literal("not-recorded-obsolete"),
      ...reviewObservation,
    }),
    z.strictObject({
      kind: z.literal("not-recorded-target-used"),
      ...reviewObservation,
      consumed: internalReviewReceiptSchema,
    }),
  ])
  .superRefine((v, ctx) => {
    const reject = () =>
      ctx.addIssue({
        code: "custom",
        message: "Contradictory original review observation.",
      });
    if (v.kind === "recorded") {
      if (
        !sameRecordBaselineBinding(v.binding, v.review.binding) ||
        v.fingerprint !== v.review.fingerprint
      )
        reject();
    } else {
      if (v.observedCurrentRevision < v.binding.target.revision) reject();
      if (
        v.kind === "not-recorded-obsolete" &&
        v.observedCurrentRevision <= v.binding.target.revision
      )
        reject();
      if (
        v.kind !== "not-recorded-obsolete" &&
        v.observedCurrentRevision !== v.binding.target.revision
      )
        reject();
      if (
        v.kind === "not-recorded-target-used" &&
        (v.consumed.binding.productId !== v.binding.productId ||
          !sameRevisionTarget(v.consumed.binding.target, v.binding.target) ||
          v.consumed.binding.idempotencyKey === v.binding.idempotencyKey)
      )
        reject();
    }
  });
const sealObservation = {
  binding: sealInternalVersionBindingSchema,
  fingerprint: sha,
  observedCurrentRevision: z.number().int().min(1).max(100),
};
export const internalVersionResolutionSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("sealed"),
      binding: sealInternalVersionBindingSchema,
      fingerprint: sha,
      version: internalVersionReceiptSchema,
    }),
    z.strictObject({ kind: z.literal("unresolved"), ...sealObservation }),
    z.strictObject({
      kind: z.literal("not-sealed-obsolete"),
      ...sealObservation,
    }),
    z.strictObject({
      kind: z.literal("not-sealed-target-used"),
      ...sealObservation,
      snapshotSha256: sha,
      consumed: internalVersionReceiptSchema,
    }),
    z.strictObject({
      kind: z.literal("not-sealed-capacity-exhausted"),
      ...sealObservation,
      limit: z.literal(100),
      occupiedCount: z.literal(100),
    }),
  ])
  .superRefine((v, ctx) => {
    const reject = () =>
      ctx.addIssue({
        code: "custom",
        message: "Contradictory original version observation.",
      });
    if (v.kind === "sealed") {
      if (
        !sameSealInternalVersionBinding(v.binding, v.version.binding) ||
        v.fingerprint !== v.version.fingerprint
      )
        reject();
    } else {
      if (v.observedCurrentRevision < v.binding.target.revision) reject();
      if (
        v.kind === "not-sealed-obsolete" &&
        v.observedCurrentRevision <= v.binding.target.revision
      )
        reject();
      if (
        v.kind !== "not-sealed-obsolete" &&
        v.observedCurrentRevision !== v.binding.target.revision
      )
        reject();
      if (v.kind === "not-sealed-target-used") {
        const { idempotencyKey: originalKey, ...original } = v.binding,
          { idempotencyKey: consumingKey, ...consuming } = v.consumed.binding;
        if (
          originalKey === consumingKey ||
          !equal(original, consuming) ||
          v.snapshotSha256 !== v.consumed.snapshotSha256
        )
          reject();
      }
    }
  });
/** Small list vocabulary, deliberately excludes operation bindings, approval facts and snapshot text. */
export const internalVersionMetadataSchema = z.strictObject({
  id: uuid,
  productId: id,
  slot: z.number().int().min(1).max(100),
  target: revisionTargetSchema,
  reviewId: uuid,
  reviewSha256: sha,
  snapshotSha256: sha,
  renderer: rendererIdentitySchema,
  rendererCapability: internalRendererCapabilitySchema,
  engine: engineIdentitySchema,
  purpose: z.literal("internal-test"),
  publicationApproved: z.literal(false),
  createdAt: moment,
  createdBy: uuid,
});
export const internalVersionListSchema = z
  .strictObject({
    productId: id,
    versions: internalVersionMetadataSchema.array().max(100),
  })
  .superRefine((v, ctx) => {
    if (
      v.versions.some(
        (item, i) =>
          item.productId !== v.productId ||
          (i > 0 && item.slot >= v.versions[i - 1]!.slot),
      ) ||
      new Set(v.versions.map((x) => x.id)).size !== v.versions.length ||
      new Set(v.versions.map((x) => x.snapshotSha256)).size !==
        v.versions.length
    )
      ctx.addIssue({ code: "custom", message: "Invalid fixed version list." });
  });
export const internalVersionDetailSchema = z
  .strictObject({
    version: internalVersionReceiptSchema,
    snapshot: internalVersionSnapshotSchema,
  })
  .superRefine((v, ctx) => {
    const a = v.version.binding,
      b = v.snapshot;
    if (
      a.productId !== b.productId ||
      !sameRevisionTarget(a.target, b.target) ||
      a.reviewId !== b.reviewId ||
      a.reviewSha256 !== b.reviewSha256 ||
      !equal(a.renderer, b.renderer) ||
      !equal(a.engine, b.engine)
    )
      ctx.addIssue({
        code: "custom",
        message: "Version receipt and immutable snapshot must agree.",
      });
  });
const rendererChoiceSchema = z.strictObject({
  renderer: rendererIdentitySchema,
  capability: internalRendererCapabilitySchema,
});
export const internalReviewStateSchema = z
  .strictObject({
    productId: id,
    target: revisionTargetSchema,
    observedCurrentRevision: z.number().int().min(1).max(100),
    review: internalReviewReceiptSchema.nullable(),
    baseline: baselineIdentitySchema.nullable(),
    rendererChoices: rendererChoiceSchema.array().max(8),
    engine: engineIdentitySchema.nullable(),
  })
  .superRefine((v, ctx) => {
    if (
      v.observedCurrentRevision < v.target.revision ||
      (v.review &&
        (v.review.binding.productId !== v.productId ||
          !sameRevisionTarget(v.review.binding.target, v.target))) ||
      new Set(v.rendererChoices.map((x) => internalCanonicalText(x.renderer)))
        .size !== v.rendererChoices.length
    )
      ctx.addIssue({ code: "custom", message: "Invalid fixed review state." });
  });
function envelope<T extends z.ZodType>(
  schema: T,
  maximum: number = L.responseBytes,
) {
  return z
    .strictObject({ ok: z.literal(true), value: schema })
    .refine((v) => withinInternalBytes(v, maximum));
}
export const recordBaselineResponseSchema = envelope(
  recordBaselineResultSchema,
);
export const sealInternalVersionResponseSchema = envelope(
  sealInternalVersionResultSchema,
);
export const internalReviewResolutionResponseSchema = envelope(
  internalReviewResolutionSchema,
);
export const internalVersionResolutionResponseSchema = envelope(
  internalVersionResolutionSchema,
);
export const internalReviewStateResponseSchema = envelope(
  internalReviewStateSchema,
);
export const internalVersionListResponseSchema = envelope(
  internalVersionListSchema,
  L.listResponseBytes,
);
export const internalVersionDetailResponseSchema = envelope(
  internalVersionDetailSchema,
);
export const internalVersionErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "PAYLOAD_TOO_LARGE",
  "UNAUTHENTICATED",
  "ORIGIN_REJECTED",
  "CSRF_REJECTED",
  "CAPABILITY_DENIED",
  "PRODUCT_NOT_FOUND",
  "DRAFT_NOT_FOUND",
  "DRAFT_REVISION_NOT_FOUND",
  "PRODUCT_ARCHIVED",
  "DRAFT_BASE_CONFLICT",
  "DRAFT_SOURCE_INVALID",
  "DRAFT_SOURCE_CHANGED",
  "IDEMPOTENCY_CONFLICT",
  "WRITE_BUSY",
  "WRITE_OUTCOME_UNKNOWN",
  "STUDIO_UNAVAILABLE",
  "REVIEW_BASELINE_MISMATCH",
  "REVIEW_ALREADY_RECORDED",
  "REVIEW_NOT_FOUND",
  "REVIEW_LIMIT",
  "VERSION_NOT_FOUND",
  "VERSION_ALREADY_SEALED",
  "VERSION_LIMIT",
  "VERSION_DEPENDENCY_UNAVAILABLE",
  "VERSION_RESOURCE_UNAVAILABLE",
  "PREVIEW_BUSY",
  "PREVIEW_TIMEOUT",
  "PREVIEW_CANCELLED",
  "PREVIEW_RESOURCE_UNAVAILABLE",
]);
export const internalVersionHttpErrorSchema = z
  .strictObject({ code: internalVersionErrorCodeSchema, requestId: uuid })
  .refine((v) => withinInternalBytes(v, L.errorResponseBytes));
export type InternalReviewResolution = z.infer<
  typeof internalReviewResolutionSchema
>;
export type InternalVersionResolution = z.infer<
  typeof internalVersionResolutionSchema
>;
export type InternalReviewState = z.infer<typeof internalReviewStateSchema>;
export type InternalVersionList = z.infer<typeof internalVersionListSchema>;
export type InternalVersionDetail = z.infer<typeof internalVersionDetailSchema>;

/** Exact new transport whitelist; currentRevision is intentionally absent from this protocol. */
export const INTERNAL_VERSION_HTTP_STATUSES: Readonly<
  Record<z.infer<typeof internalVersionErrorCodeSchema>, number>
> = Object.freeze({
  INVALID_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  UNAUTHENTICATED: 401,
  ORIGIN_REJECTED: 403,
  CSRF_REJECTED: 403,
  CAPABILITY_DENIED: 403,
  PRODUCT_NOT_FOUND: 404,
  DRAFT_NOT_FOUND: 404,
  DRAFT_REVISION_NOT_FOUND: 404,
  PRODUCT_ARCHIVED: 409,
  DRAFT_BASE_CONFLICT: 409,
  DRAFT_SOURCE_INVALID: 409,
  DRAFT_SOURCE_CHANGED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  WRITE_BUSY: 409,
  WRITE_OUTCOME_UNKNOWN: 503,
  STUDIO_UNAVAILABLE: 503,
  REVIEW_BASELINE_MISMATCH: 409,
  REVIEW_ALREADY_RECORDED: 409,
  REVIEW_NOT_FOUND: 404,
  REVIEW_LIMIT: 409,
  VERSION_NOT_FOUND: 404,
  VERSION_ALREADY_SEALED: 409,
  VERSION_LIMIT: 409,
  VERSION_DEPENDENCY_UNAVAILABLE: 503,
  VERSION_RESOURCE_UNAVAILABLE: 503,
  PREVIEW_BUSY: 503,
  PREVIEW_TIMEOUT: 504,
  PREVIEW_CANCELLED: 499,
  PREVIEW_RESOURCE_UNAVAILABLE: 503,
});
