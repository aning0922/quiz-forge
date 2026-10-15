import { z } from "zod";
import {
  engineDeclarationSchema,
  packIdSchema,
  packVersionSchema,
  sha256Schema,
} from "@/features/quizpack/v1/manifest";
import { importIdSchema } from "@/features/quizpack/import/contracts";

export const DRAFT_LIMITS = Object.freeze({
  contentBytes: 2_097_152,
  assetSetBytes: 65_536,
  revisionResponseBytes: 4_390_912,
  smallResponseBytes: 65_536,
  pendingEntries: 16,
  pendingEntryBytes: 4096,
  pendingBucketBytes: 65_536,
});
export const draftIdSchema = importIdSchema;
export const draftApplicationIdSchema = importIdSchema;
export const draftIdempotencyKeySchema = importIdSchema;
export const draftRevisionSchema = z.literal(1);
export const validationStateRevisionSchema = z
  .number()
  .int()
  .min(1)
  .max(2_147_483_647);
export const draftTargetSchema = z.strictObject({
  kind: z.literal("new-draft"),
});
export const draftApplicationScopeSchema = z.strictObject({
  productId: packIdSchema,
  sourceImportId: importIdSchema,
  sourceValidationId: importIdSchema,
});
export const applyReadyValidationSchema = z.strictObject({
  idempotencyKey: draftIdempotencyKeySchema,
  expectedValidationStateRevision: validationStateRevisionSchema,
  expectedCandidateSha256: sha256Schema,
  target: draftTargetSchema,
});
export const draftApplicationBindingSchema = z.strictObject({
  ...draftApplicationScopeSchema.shape,
  ...applyReadyValidationSchema.shape,
});
export const draftApplicationFingerprintInputSchema = z.strictObject({
  ...draftApplicationScopeSchema.shape,
  expectedValidationStateRevision: validationStateRevisionSchema,
  expectedCandidateSha256: sha256Schema,
  target: draftTargetSchema,
});
/** Browser-safe input contract. The server hashes canonicalP1Json of these explicit fields only. */
export function draftApplicationFingerprintPayload(input: unknown) {
  const value = draftApplicationFingerprintInputSchema.parse(input);
  return {
    schemaVersion: "quizpack-draft-application.v1" as const,
    productId: value.productId,
    sourceImportId: value.sourceImportId,
    sourceValidationId: value.sourceValidationId,
    expectedValidationStateRevision: value.expectedValidationStateRevision,
    expectedCandidateSha256: value.expectedCandidateSha256,
    target: { kind: "new-draft" as const },
  };
}
/** Strict ASCII fields and one literal target make this explicit key order exactly canonicalP1Json. */
export function draftApplicationFingerprintText(input: unknown): string {
  const value = draftApplicationFingerprintPayload(input);
  return JSON.stringify({
    expectedCandidateSha256: value.expectedCandidateSha256,
    expectedValidationStateRevision: value.expectedValidationStateRevision,
    productId: value.productId,
    schemaVersion: value.schemaVersion,
    sourceImportId: value.sourceImportId,
    sourceValidationId: value.sourceValidationId,
    target: value.target,
  });
}
/** One deterministic implementation for Node and browsers; no current time, request ID or key is hashed. */
export async function draftApplicationFingerprint(
  input: unknown,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    draftApplicationFingerprintText(input),
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export const draftVersionsSchema = z.strictObject({
  contentVersion: packVersionSchema,
  visualVersion: packVersionSchema,
  reportVersion: packVersionSchema,
  resourceVersion: packVersionSchema,
  componentVersion: packVersionSchema,
  engine: engineDeclarationSchema,
});
const snapshotShape = {
  productId: packIdSchema,
  draftId: draftIdSchema,
  revision: draftRevisionSchema,
  applicationId: draftApplicationIdSchema,
  sourceImportId: importIdSchema,
  sourceValidationId: importIdSchema,
  canonicalContentSha256: sha256Schema,
  assetSetSha256: sha256Schema,
  canonicalManifestSha256: sha256Schema,
  candidateSha256: sha256Schema,
  containerSchemaVersion: z.literal("quizpack.v1"),
  contentSchemaVersion: z.enum(["quizpack-content.v1", "quizpack-content.v2"]),
  contentKind: z.enum(["synthetic", "authored"]),
  packId: packIdSchema,
  packVersion: packVersionSchema,
  versions: draftVersionsSchema,
  resourceCount: z.number().int().min(1).max(64),
  createdAt: z.iso.datetime({ precision: 3 }),
  createdBy: importIdSchema,
  platformApproval: z.literal("unverified"),
  publishable: z.literal(false),
};
// Read-only receipts retain historical version metadata. Current component matrix
// eligibility is enforced when reading a new ready source, never retroactively.
export const draftSummarySchema = z.strictObject(snapshotShape);
export const draftApplicationDtoSchema = z
  .strictObject({
    ...snapshotShape,
    idempotencyKey: draftIdempotencyKeySchema,
    expectedValidationStateRevision: validationStateRevisionSchema,
    expectedCandidateSha256: sha256Schema,
    fingerprint: sha256Schema,
    target: draftTargetSchema,
  })
  .refine((value) => value.expectedCandidateSha256 === value.candidateSha256);
export const applyDraftResultSchema = z.strictObject({
  created: z.boolean(),
  application: draftApplicationDtoSchema,
});
export const draftReadResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("empty"), productId: packIdSchema }),
  z.strictObject({ kind: z.literal("draft"), draft: draftSummarySchema }),
]);
export const draftApplicationReadResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("empty"),
    productId: packIdSchema,
    idempotencyKey: draftIdempotencyKeySchema,
  }),
  z.strictObject({
    kind: z.literal("applied"),
    application: draftApplicationDtoSchema,
  }),
]);
const canonicalText = (maximum: number) =>
  z
    .string()
    .min(2)
    .max(maximum)
    .refine(
      (text) =>
        new TextEncoder().encode(text).byteLength <= maximum &&
        !/[\u0000-\u001f]/u.test(text),
    );
export const draftRevisionDtoSchema = z.strictObject({
  draft: draftSummarySchema,
  canonicalContentText: canonicalText(DRAFT_LIMITS.contentBytes),
  assetSetText: canonicalText(DRAFT_LIMITS.assetSetBytes),
});
export type DraftApplicationScope = z.infer<typeof draftApplicationScopeSchema>;
export type ApplyReadyValidation = z.infer<typeof applyReadyValidationSchema>;
export type DraftApplicationBinding = z.infer<
  typeof draftApplicationBindingSchema
>;
export type DraftApplicationFingerprintInput = z.infer<
  typeof draftApplicationFingerprintInputSchema
>;
export type DraftVersions = z.infer<typeof draftVersionsSchema>;
export type DraftSummaryDto = z.infer<typeof draftSummarySchema>;
export type DraftApplicationDto = z.infer<typeof draftApplicationDtoSchema>;
export type ApplyDraftResult = z.infer<typeof applyDraftResultSchema>;
export type DraftReadResult = z.infer<typeof draftReadResultSchema>;
export type DraftApplicationReadResult = z.infer<
  typeof draftApplicationReadResultSchema
>;
export type DraftRevisionDto = z.infer<typeof draftRevisionDtoSchema>;
