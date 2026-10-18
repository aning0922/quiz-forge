import { z } from "zod";
import {
  assessmentIdSchema,
  assessmentVersionSchema,
  sha256Schema,
  engineDeclarationSchema,
} from "@/lib/assessment-contract/primitives";
import { canonicalInternalJson } from "./canonical";
import { importIdSchema } from "@/features/quizpack/import/contracts";

import { DISPLAY_COMPONENT_IDS_V1 } from "@/lib/assessment-contract/display-limits-v1";
const id = assessmentIdSchema.refine((v) => !/[\r\n]/.test(v));
const version = assessmentVersionSchema.refine((v) => !/[\r\n]/.test(v));
const sha = sha256Schema.length(64);
const uuid = importIdSchema.length(36);

/** These v1 limits and head-only semantics are permanent proof assumptions. */
export const INTERNAL_VERSION_LIMITS = Object.freeze({
  maximumRevision: 100,
  maximumReviews: 100,
  maximumVersions: 100,
  requestBytes: 4096,
  responseBytes: 65_536,
  errorResponseBytes: 4096,
  listResponseBytes: 262_144,
  snapshotBytes: 32_768,
  reviewFactsBytes: 8192,
  pendingEntries: 16,
  pendingEntryBytes: 4096,
  pendingBucketBytes: 65_536,
  operationDeadlineMs: 15_000,
  resourceBytes: 33_554_432,
  resources: 64,
});
export const revisionTargetSchema = z.strictObject({
  draftId: uuid,
  revision: z.number().int().min(1).max(100),
  canonicalContentSha256: sha,
  assetSetSha256: sha,
  canonicalManifestSha256: sha,
});
const registryIdentity = { id, version, entrySha256: sha };
export const baselineIdentitySchema = z.strictObject({
  kind: z.literal("baseline"),
  ...registryIdentity,
});
export const rendererIdentitySchema = z.strictObject({
  kind: z.literal("renderer"),
  ...registryIdentity,
});
export const engineIdentitySchema = z.strictObject({
  kind: z.literal("engine"),
  ...registryIdentity,
  id: engineDeclarationSchema.shape.id,
  version: engineDeclarationSchema.shape.version,
});
export const baselineApprovalSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("author-baseline"),
    approvedOn: z.iso.date(),
    sourceRecordId: id,
    evidenceSha256: sha,
    scope: z.literal("internal-test-content-and-visual-baseline"),
  }),
  z.strictObject({
    kind: z.literal("synthetic-test"),
    fixtureId: id,
    evidenceSha256: sha,
    scope: z.literal("test-evidence-no-author-approval"),
  }),
]);
export const internalReviewFactsSchema = z.strictObject({
  schemaVersion: z.literal("quizforge.internal-review-facts.v1"),
  productId: id,
  target: revisionTargetSchema,
  baseline: baselineIdentitySchema,
  purpose: z.literal("internal-test"),
  approval: baselineApprovalSchema,
});
export const fixedFontIdentitySchema = z.strictObject({
  id,
  version,
  fileSha256: sha,
  coverageSha256: sha,
  licenseSha256: sha,
  weight: z.literal(600),
});
const component = <S extends keyof typeof DISPLAY_COMPONENT_IDS_V1>(state: S) =>
  z.strictObject({
    id: z.literal(DISPLAY_COMPONENT_IDS_V1[state]),
    version: z.literal("2.0.0"),
    propsSchemaVersion: z.literal("1.0.0"),
  });
export const fixedDisplayComponentsSchema = z.strictObject({
  cover: component("cover"),
  question: component("question"),
  resume: component("resume"),
  result: component("result"),
  report: component("report"),
  poster: component("poster"),
});
/** Describes existing executable capability only. Adding consumer support needs a new protocol/entry. */
export const internalRendererCapabilitySchema = z.literal(
  "studio-internal-preview",
);
export const fixedValidationIdentitySchema = z.strictObject({
  sourceImportId: uuid,
  sourceValidationId: uuid,
  sourceValidationStateRevision: z.number().int().min(1).max(2147483647),
  archiveSha256: sha,
  candidateSha256: sha,
  identitySha256: sha,
  validatorBundleSha256: sha,
  archivePolicyVersion: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[\x21-\x7e]+(?![\s\S])/),
  archivePolicySha256: sha,
  evidenceSha256: sha,
});
export const internalVersionSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.internal-version-snapshot.v1"),
    productId: id,
    target: revisionTargetSchema,
    reviewId: uuid,
    reviewSha256: sha,
    baseline: baselineIdentitySchema,
    purpose: z.literal("internal-test"),
    publicationApproved: z.literal(false),
    contentSchemaVersion: z.literal("quizpack-content.v2"),
    contentKind: z.enum(["authored", "synthetic"]),
    packId: id,
    packVersion: version,
    versions: z.strictObject({
      contentVersion: version,
      visualVersion: version,
      reportVersion: version,
      resourceVersion: version,
      componentVersion: version,
      engine: engineDeclarationSchema,
    }),
    logicHash: sha,
    renderer: rendererIdentitySchema,
    rendererCapability: internalRendererCapabilitySchema,
    components: fixedDisplayComponentsSchema,
    engine: engineIdentitySchema,
    font: fixedFontIdentitySchema,
    validation: fixedValidationIdentitySchema,
  })
  .refine(
    (v) =>
      withinInternalBytes(v, INTERNAL_VERSION_LIMITS.snapshotBytes) &&
      v.versions.componentVersion === "2.0.0" &&
      v.engine.id === v.versions.engine.id &&
      v.engine.version === v.versions.engine.version,
  );
export function withinInternalBytes(value: unknown, maximum: number): boolean {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength <= maximum;
}
export function internalCanonicalText(
  value: unknown,
  maximum: number = INTERNAL_VERSION_LIMITS.responseBytes,
): string {
  return canonicalInternalJson(value, { maxBytes: maximum, maxDepth: 32 });
}
export async function hashInternalText(text: string): Promise<string> {
  const result = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(result)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export const reviewFactsText = (value: unknown) =>
  internalCanonicalText(
    internalReviewFactsSchema.parse(value),
    INTERNAL_VERSION_LIMITS.reviewFactsBytes,
  );
export const internalSnapshotText = (value: unknown) =>
  internalCanonicalText(
    internalVersionSnapshotSchema.parse(value),
    INTERNAL_VERSION_LIMITS.snapshotBytes,
  );
export type RevisionTarget = z.infer<typeof revisionTargetSchema>;
export type BaselineIdentity = z.infer<typeof baselineIdentitySchema>;
export type RendererIdentity = z.infer<typeof rendererIdentitySchema>;
export type EngineIdentity = z.infer<typeof engineIdentitySchema>;
export type InternalReviewFacts = z.infer<typeof internalReviewFactsSchema>;
export type InternalVersionSnapshot = z.infer<
  typeof internalVersionSnapshotSchema
>;
export function sameRevisionTarget(
  a: RevisionTarget,
  b: RevisionTarget,
): boolean {
  return (
    JSON.stringify(revisionTargetSchema.parse(a)) ===
    JSON.stringify(revisionTargetSchema.parse(b))
  );
}
