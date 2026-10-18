import { z } from "zod";
import {
  assessmentIdSchema as id,
  assessmentVersionSchema as version,
  assessmentReferenceSchema as ref,
  sha256Schema,
} from "@/lib/assessment-contract/primitives";
import { SCORING_LIMITS } from "@/lib/assessment-contract/scoring-v1";
import { importIdSchema as draftIdSchema } from "@/features/quizpack/import/contracts";
import {
  displayEntryBodyShapeV1,
  resultDisplaySnapshotShapeV1,
  displayPosterExportBodyShapeV1,
  checkDisplayEntryRelationsV1,
  checkResultDisplayRelationsV1,
  checkDisplayPosterExportRelationsV1,
} from "@/lib/assessment-contract/display-v1";
export {
  displayAssetV1Schema as previewAssetSchema,
  displayQuestionV1Schema as previewQuestionSchema,
  displayDimensionV1Schema as previewDimensionSchema,
  displayPosterV1Schema as previewPosterSchema,
} from "@/lib/assessment-contract/display-v1";
export type {
  DisplayAssetV1 as PreviewAsset,
  DisplayPosterV1 as PreviewPoster,
} from "@/lib/assessment-contract/display-v1";
import { PREVIEW_FONT, PREVIEW_RENDERER } from "./descriptor";
import { PREVIEW_LIMITS } from "./limits";
export const previewScopeSchema = z.strictObject({
  productId: id,
  draftId: draftIdSchema,
  revision: z.number().int().min(1).max(2_147_483_647),
});
export const previewBindingSchema = previewScopeSchema.extend({
  canonicalContentSha256: sha256Schema,
  assetSetSha256: sha256Schema,
  renderer: z.strictObject({ id, version }),
  font: z.strictObject({
    id,
    version,
    fileSha256: sha256Schema,
    coverageSha256: sha256Schema,
  }),
});
export type PreviewBinding = z.infer<typeof previewBindingSchema>;
export type PreviewScope = z.infer<typeof previewScopeSchema>;
export function bindingUsesCurrentRenderer(binding: PreviewBinding): boolean {
  return (
    binding.renderer.id === PREVIEW_RENDERER.id &&
    binding.renderer.version === PREVIEW_RENDERER.version &&
    binding.font.id === PREVIEW_FONT.id &&
    binding.font.version === PREVIEW_FONT.version &&
    binding.font.fileSha256 === PREVIEW_FONT.fileSha256 &&
    binding.font.coverageSha256 === PREVIEW_FONT.coverageSha256
  );
}
export function samePreviewBinding(
  a: PreviewBinding,
  b: PreviewBinding,
): boolean {
  return (
    a.productId === b.productId &&
    a.draftId === b.draftId &&
    a.revision === b.revision &&
    a.canonicalContentSha256 === b.canonicalContentSha256 &&
    a.assetSetSha256 === b.assetSetSha256 &&
    a.renderer.id === b.renderer.id &&
    a.renderer.version === b.renderer.version &&
    a.font.id === b.font.id &&
    a.font.version === b.font.version &&
    a.font.fileSha256 === b.font.fileSha256 &&
    a.font.coverageSha256 === b.font.coverageSha256
  );
}
export const previewErrorCodeSchema = z.enum([
  "PREVIEW_UNSUPPORTED",
  "PREVIEW_BINDING_MISMATCH",
  "PREVIEW_LIMIT_EXCEEDED",
  "PREVIEW_INVALID_ANSWERS",
  "PREVIEW_RESOURCE_UNAVAILABLE",
  "PREVIEW_BUSY",
  "PREVIEW_TIMEOUT",
  "PREVIEW_CANCELLED",
]);
export type PreviewErrorCode = z.infer<typeof previewErrorCodeSchema>;
export type PreviewResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; code: PreviewErrorCode }>;
export const previewEntrySchema = z
  .strictObject({
    binding: previewBindingSchema,
    ...displayEntryBodyShapeV1.shape,
  })
  .superRefine((value, ctx) =>
    checkDisplayEntryRelationsV1(value, ctx, value.binding.productId),
  );
export type PreviewEntry = z.infer<typeof previewEntrySchema>;
export const previewAnswersSchema = z
  .array(z.strictObject({ questionId: id, optionId: id }))
  .min(1)
  .max(SCORING_LIMITS.questions);
export const previewRequestIdSchema = draftIdSchema;
export const previewScoreRequestSchema = z.strictObject({
  binding: previewBindingSchema,
  requestId: previewRequestIdSchema,
  answers: previewAnswersSchema,
});
export type PreviewScoreRequest = z.infer<typeof previewScoreRequestSchema>;
export const previewRevealSchema = z
  .strictObject({
    binding: previewBindingSchema,
    requestId: previewRequestIdSchema,
    ...resultDisplaySnapshotShapeV1.shape,
  })
  .superRefine((value, ctx) =>
    checkResultDisplayRelationsV1(value, ctx, value.binding.productId),
  );
export type PreviewReveal = z.infer<typeof previewRevealSchema>;
export const previewEntryResponseSchema = z
  .strictObject({ ok: z.literal(true), value: previewEntrySchema })
  .superRefine((v, ctx) => {
    if (
      new TextEncoder().encode(JSON.stringify(v)).byteLength >
      PREVIEW_LIMITS.entryResponseBytes
    )
      ctx.addIssue({
        code: "custom",
        message: "Complete preview entry envelope exceeds its byte budget.",
      });
  });
export const previewRevealResponseSchema = z
  .strictObject({ ok: z.literal(true), value: previewRevealSchema })
  .superRefine((v, ctx) => {
    if (
      new TextEncoder().encode(JSON.stringify(v)).byteLength >
      PREVIEW_LIMITS.revealResponseBytes
    )
      ctx.addIssue({
        code: "custom",
        message: "Complete preview reveal envelope exceeds its byte budget.",
      });
  });
export const previewResourceRequestSchema = z.strictObject({
  binding: previewBindingSchema,
  resourceRef: ref,
});
export type PreviewResourceRequest = z.infer<
  typeof previewResourceRequestSchema
>;
/** Standalone export input retains the actual accepted result's identity. */
export const previewPosterExportSchema = z
  .strictObject({
    binding: previewBindingSchema,
    requestId: previewRequestIdSchema,
    ...displayPosterExportBodyShapeV1.shape,
  })
  .superRefine((value, ctx) =>
    checkDisplayPosterExportRelationsV1(value, ctx, value.binding.productId),
  );
export type PreviewPosterExport = z.infer<typeof previewPosterExportSchema>;
/** Transport errors use the server observation ID; successful scoring echoes the caller requestId. */
export const previewHttpErrorSchema = z.strictObject({
  code: z.union([
    previewErrorCodeSchema,
    z.enum([
      "INVALID_REQUEST",
      "PAYLOAD_TOO_LARGE",
      "UNAUTHENTICATED",
      "ORIGIN_REJECTED",
      "CSRF_REJECTED",
      "CAPABILITY_DENIED",
      "PRODUCT_NOT_FOUND",
      "DRAFT_NOT_FOUND",
      "DRAFT_REVISION_NOT_FOUND",
      "STUDIO_UNAVAILABLE",
    ]),
  ]),
  requestId: previewRequestIdSchema,
});
