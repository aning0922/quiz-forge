import { z } from "zod";
import { sha256Schema } from "@/features/quizpack/v1/manifest";
import {
  draftApplicationScopeSchema,
  draftIdSchema,
  draftIdempotencyKeySchema,
  draftSummarySchema,
  validationStateRevisionSchema,
} from "../drafts/contracts";

export const DRAFT_REVISION_LIMITS = Object.freeze({
  maximumRevision: 100,
  requestBytes: 4096,
  responseBytes: 65_536,
  historyResponseBytes: 131_072,
  errorResponseBytes: 4096,
  queryBytes: 4096,
  historyDefaultPageSize: 20,
  historyMaxPageSize: 50,
  pendingEntries: 16,
  pendingEntryBytes: 4096,
  pendingBucketBytes: 65_536,
});
export const boundedDraftRevisionSchema = z.number().int().min(1).max(100);
export const appendDraftTargetSchema = z.strictObject({
  kind: z.literal("append-revision"),
  draftId: draftIdSchema,
  expectedRevision: boundedDraftRevisionSchema,
  expectedCanonicalContentSha256: sha256Schema,
  expectedAssetSetSha256: sha256Schema,
});
export const appendReadyValidationSchema = z.strictObject({
  idempotencyKey: draftIdempotencyKeySchema,
  expectedValidationStateRevision: validationStateRevisionSchema,
  expectedCandidateSha256: sha256Schema,
  target: appendDraftTargetSchema,
});
export const appendDraftBindingSchema = z.strictObject({
  ...draftApplicationScopeSchema.shape,
  ...appendReadyValidationSchema.shape,
});
export const appendDraftFingerprintInputSchema = z.strictObject({
  ...draftApplicationScopeSchema.shape,
  expectedValidationStateRevision: validationStateRevisionSchema,
  expectedCandidateSha256: sha256Schema,
  target: appendDraftTargetSchema,
});
export function appendDraftFingerprintPayload(input: unknown) {
  const value = appendDraftFingerprintInputSchema.parse(input);
  return {
    schemaVersion: "quizpack-draft-revision-application.v1" as const,
    ...value,
  };
}
/** The same explicit canonical key order is implemented by the SQL helper. */
export function appendDraftFingerprintText(input: unknown): string {
  const value = appendDraftFingerprintPayload(input);
  return JSON.stringify({
    expectedCandidateSha256: value.expectedCandidateSha256,
    expectedValidationStateRevision: value.expectedValidationStateRevision,
    productId: value.productId,
    schemaVersion: value.schemaVersion,
    sourceImportId: value.sourceImportId,
    sourceValidationId: value.sourceValidationId,
    target: {
      draftId: value.target.draftId,
      expectedAssetSetSha256: value.target.expectedAssetSetSha256,
      expectedCanonicalContentSha256:
        value.target.expectedCanonicalContentSha256,
      expectedRevision: value.target.expectedRevision,
      kind: value.target.kind,
    },
  });
}
export async function appendDraftFingerprint(input: unknown): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(appendDraftFingerprintText(input)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export function fingerprintInputFromAppendBinding(input: unknown) {
  const value = appendDraftBindingSchema.parse(input);
  return appendDraftFingerprintInputSchema.parse({
    productId: value.productId,
    sourceImportId: value.sourceImportId,
    sourceValidationId: value.sourceValidationId,
    expectedValidationStateRevision: value.expectedValidationStateRevision,
    expectedCandidateSha256: value.expectedCandidateSha256,
    target: value.target,
  });
}
export function sameAppendDraftBinding(a: unknown, b: unknown): boolean {
  return (
    JSON.stringify(appendDraftBindingSchema.parse(a)) ===
    JSON.stringify(appendDraftBindingSchema.parse(b))
  );
}
function withinBytes(value: unknown, maximum: number): boolean {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength <= maximum;
}
export const appendDraftApplicationSchema = z
  .strictObject({
    ...draftSummarySchema.shape,
    revision: z.number().int().min(2).max(100),
    idempotencyKey: draftIdempotencyKeySchema,
    expectedValidationStateRevision: validationStateRevisionSchema,
    expectedCandidateSha256: sha256Schema,
    fingerprint: sha256Schema,
    target: appendDraftTargetSchema,
  })
  .refine(
    (v) =>
      v.draftId === v.target.draftId &&
      v.target.expectedRevision < 100 &&
      v.revision === v.target.expectedRevision + 1 &&
      v.candidateSha256 === v.expectedCandidateSha256,
  );
export function appendBindingFromApplication(input: unknown) {
  const v = appendDraftApplicationSchema.parse(input);
  return appendDraftBindingSchema.parse({
    productId: v.productId,
    sourceImportId: v.sourceImportId,
    sourceValidationId: v.sourceValidationId,
    idempotencyKey: v.idempotencyKey,
    expectedValidationStateRevision: v.expectedValidationStateRevision,
    expectedCandidateSha256: v.expectedCandidateSha256,
    target: v.target,
  });
}
export const appendDraftResultSchema = z
  .strictObject({
    created: z.boolean(),
    application: appendDraftApplicationSchema,
  })
  .refine((v) => withinBytes(v, DRAFT_REVISION_LIMITS.responseBytes));
const resolutionCommon = {
  binding: appendDraftBindingSchema,
  fingerprint: sha256Schema,
};
const observation = {
  ...resolutionCommon,
  base: draftSummarySchema,
  observedCurrentRevision: boundedDraftRevisionSchema,
};
export const sourceUsedProofSchema = z.discriminatedUnion("reason", [
  z.strictObject({
    reason: z.literal("source-import"),
    consumed: draftSummarySchema,
    consumingIdempotencyKey: draftIdempotencyKeySchema,
  }),
  z.strictObject({
    reason: z.literal("canonical-manifest"),
    consumed: draftSummarySchema,
    consumingIdempotencyKey: draftIdempotencyKeySchema,
    canonicalManifestSha256: sha256Schema,
  }),
]);
export const draftRevisionResolutionSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("applied"),
      ...resolutionCommon,
      application: appendDraftApplicationSchema,
    }),
    z.strictObject({ kind: z.literal("unresolved"), ...observation }),
    z.strictObject({ kind: z.literal("not-applied-obsolete"), ...observation }),
    z.strictObject({
      kind: z.literal("not-applied-source-used"),
      ...observation,
      proof: sourceUsedProofSchema,
    }),
  ])
  .superRefine((v, ctx) => {
    const invalid = () =>
      ctx.addIssue({
        code: "custom",
        message: "Invalid fixed revision observation",
      });
    if (!withinBytes(v, DRAFT_REVISION_LIMITS.responseBytes)) invalid();
    if (v.kind === "applied") {
      if (
        !sameAppendDraftBinding(
          v.binding,
          appendBindingFromApplication(v.application),
        ) ||
        v.fingerprint !== v.application.fingerprint
      )
        invalid();
      return;
    }
    const { binding: b, base } = v;
    if (
      base.productId !== b.productId ||
      base.draftId !== b.target.draftId ||
      base.revision !== b.target.expectedRevision ||
      base.canonicalContentSha256 !== b.target.expectedCanonicalContentSha256 ||
      base.assetSetSha256 !== b.target.expectedAssetSetSha256
    )
      invalid();
    if (v.kind === "not-applied-obsolete") {
      if (v.observedCurrentRevision <= b.target.expectedRevision) invalid();
    } else if (v.observedCurrentRevision !== b.target.expectedRevision)
      invalid();
    if (v.kind === "not-applied-source-used") {
      const p = v.proof,
        r = p.consumed;
      if (
        r.productId !== b.productId ||
        r.draftId !== b.target.draftId ||
        r.revision > v.observedCurrentRevision ||
        p.consumingIdempotencyKey === b.idempotencyKey
      )
        invalid();
      if (p.reason === "source-import") {
        if (r.sourceImportId !== b.sourceImportId) invalid();
      } else if (r.canonicalManifestSha256 !== p.canonicalManifestSha256)
        invalid();
    }
  });
export const draftRevisionHistoryQuerySchema = z
  .strictObject({
    pageSize: z.number().int().min(1).max(50).default(20),
    anchorRevision: boundedDraftRevisionSchema.optional(),
    beforeRevision: z.number().int().min(2).max(101).optional(),
  })
  .refine(
    (v) =>
      v.beforeRevision === undefined ||
      (v.anchorRevision !== undefined &&
        v.beforeRevision <= v.anchorRevision + 1),
  );
export const draftRevisionHistorySchema = z
  .strictObject({
    ...draftApplicationScopeSchema.pick({ productId: true }).shape,
    draftId: draftIdSchema,
    anchorRevision: boundedDraftRevisionSchema,
    beforeRevision: z.number().int().min(2).max(101),
    pageSize: z.number().int().min(1).max(50),
    items: z.array(draftSummarySchema).min(1).max(50),
    nextBeforeRevision: z.number().int().min(2).max(100).nullable(),
  })
  .superRefine((v, ctx) => {
    const invalid = () =>
      ctx.addIssue({
        code: "custom",
        message: "Invalid fixed revision history page",
      });
    if (
      !withinBytes(v, DRAFT_REVISION_LIMITS.historyResponseBytes) ||
      v.beforeRevision > v.anchorRevision + 1
    )
      invalid();
    const first = Math.min(v.anchorRevision, v.beforeRevision - 1);
    if (v.items.length !== Math.min(v.pageSize, first)) invalid();
    for (const [index, item] of v.items.entries()) {
      if (
        item.productId !== v.productId ||
        item.draftId !== v.draftId ||
        item.revision !== first - index
      )
        invalid();
    }
    const last = v.items.at(-1)?.revision;
    if (last !== undefined && v.nextBeforeRevision !== (last > 1 ? last : null))
      invalid();
  });
export type AppendDraftTarget = z.infer<typeof appendDraftTargetSchema>;
export type AppendReadyValidation = z.infer<typeof appendReadyValidationSchema>;
export type AppendDraftBinding = z.infer<typeof appendDraftBindingSchema>;
export type AppendDraftApplication = z.infer<
  typeof appendDraftApplicationSchema
>;
export type AppendDraftResult = z.infer<typeof appendDraftResultSchema>;
export type DraftRevisionResolution = z.infer<
  typeof draftRevisionResolutionSchema
>;
export type DraftRevisionHistoryQuery = z.infer<
  typeof draftRevisionHistoryQuerySchema
>;
export type DraftRevisionHistory = z.infer<typeof draftRevisionHistorySchema>;
