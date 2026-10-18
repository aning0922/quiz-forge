import { z } from "zod";
import {
  draftApplicationScopeSchema,
  draftSummarySchema,
} from "@/features/product/drafts/contracts";
import {
  revisionTargetSchema,
  baselineIdentitySchema,
  rendererIdentitySchema,
  engineIdentitySchema,
  internalReviewReceiptSchema,
  internalVersionDetailSchema,
  sameRevisionTarget,
} from "@/features/product/internal-versions/contracts";
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const actor = z.strictObject({
  identifier: z.uuid(),
  secret: z.string().regex(/^qfo_p2a_[A-Za-z0-9_-]{43}$/),
});
export const INTERNAL_VERSION_FIXTURE_PRIVATE_NAME =
  "internal-version-p3e-e2e-fixture.json";
export const INTERNAL_VERSION_FIXTURE_MAX_BYTES = 65_536;
export const internalVersionFixtureSourceSchema = z.strictObject({
  name: z.enum(["baseline", "next"]),
  scope: draftApplicationScopeSchema,
  expectedValidationStateRevision: z.number().int().min(1).max(2147483647),
  expectedCandidateSha256: sha,
  canonicalContentSha256: sha,
  assetSetSha256: sha,
  canonicalManifestSha256: sha,
  packVersion: z.enum(["1.0.1", "1.0.2"]),
});
export const internalVersionFixtureSchema = z
  .strictObject({
    version: z.literal(1),
    qualification: z.literal("synthetic-db-and-private-pixels-no-native"),
    instanceId: z.string().regex(/^[a-f0-9]{32}$/),
    runId: z.uuid(),
    writerPid: z.number().int().positive(),
    prepared: z.boolean(),
    completed: z.boolean(),
    productId: z.literal("internal-version-fixture"),
    draftId: z.uuid().nullable(),
    initialIdempotencyKey: z.uuid().nullable(),
    initial: draftSummarySchema.nullable(),
    target: revisionTargetSchema.nullable(),
    operator: actor,
    readOnly: actor,
    baseline: baselineIdentitySchema.nullable(),
    renderer: rendererIdentitySchema.nullable(),
    engine: engineIdentitySchema.nullable(),
    sources: internalVersionFixtureSourceSchema.array().max(2),
    blobs: z
      .strictObject({
        sha256: sha,
        bytes: z.number().int().positive().max(8388608),
        created: z.boolean(),
      })
      .array()
      .max(5),
    review: internalReviewReceiptSchema.nullable(),
    versionDetail: internalVersionDetailSchema.nullable(),
  })
  .superRefine((v, ctx) => {
    const bad = () =>
      ctx.addIssue({
        code: "custom",
        message: "Internal version fixture ownership must be exact.",
      });
    if (
      v.operator.identifier === v.readOnly.identifier ||
      (v.completed && !v.prepared) ||
      new Set(v.sources.map((s) => s.name)).size !== v.sources.length ||
      new Set(v.sources.map((s) => s.scope.sourceImportId)).size !==
        v.sources.length ||
      new Set(v.sources.map((s) => s.scope.sourceValidationId)).size !==
        v.sources.length ||
      new Set(v.blobs.map((b) => b.sha256)).size !== v.blobs.length ||
      v.sources.some(
        (s) =>
          s.scope.productId !== v.productId ||
          s.packVersion !== (s.name === "baseline" ? "1.0.1" : "1.0.2"),
      )
    )
      bad();
    if (v.prepared) {
      const source = v.sources.find((s) => s.name === "baseline");
      if (
        !v.draftId ||
        !v.initialIdempotencyKey ||
        !v.initial ||
        !v.target ||
        !v.baseline ||
        !v.renderer ||
        !v.engine ||
        v.sources.length !== 2 ||
        v.blobs.length !== 5 ||
        !source ||
        v.initial.productId !== v.productId ||
        v.initial.draftId !== v.draftId ||
        v.initial.revision !== 1 ||
        v.initial.createdBy !== v.operator.identifier ||
        v.target.draftId !== v.draftId ||
        v.target.revision !== 1 ||
        v.target.canonicalContentSha256 !== source.canonicalContentSha256 ||
        v.target.assetSetSha256 !== source.assetSetSha256 ||
        v.target.canonicalManifestSha256 !== source.canonicalManifestSha256 ||
        v.initial.sourceImportId !== source.scope.sourceImportId ||
        v.initial.sourceValidationId !== source.scope.sourceValidationId
      )
        bad();
    }
    if (v.completed && (!v.review || !v.versionDetail)) bad();
    if (
      v.review &&
      (!v.target ||
        !sameRevisionTarget(v.review.binding.target, v.target) ||
        v.review.binding.productId !== v.productId ||
        v.review.recordedBy !== v.operator.identifier ||
        v.review.facts.approval.kind !== "synthetic-test")
    )
      bad();
    if (
      v.versionDetail &&
      (!v.review ||
        v.versionDetail.version.createdBy !== v.operator.identifier ||
        v.versionDetail.version.binding.reviewId !== v.review.id ||
        v.versionDetail.version.binding.reviewSha256 !== v.review.reviewSha256)
    )
      bad();
  });
export type InternalVersionFixture = z.infer<
  typeof internalVersionFixtureSchema
>;
