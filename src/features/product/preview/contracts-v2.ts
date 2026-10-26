import { z } from "zod";
import { previewScopeSchema, previewBindingSchema } from "./contracts";
import { sha256Schema } from "@/lib/assessment-contract/primitives";
import {
  displayEntryBodyV2Schema,
  resultDisplaySnapshotV2Schema,
} from "@/lib/assessment-contract/display-v2";
import { structuredFontIdentityV2Schema } from "@/lib/consumer-contract/v2/identities";
import { matchingContextV1Schema } from "@/lib/assessment-contract/matching-v1";
import { consumerAnswersSchema } from "@/lib/consumer-contract/v1/state";
import { consumerUuidSchema } from "@/lib/consumer-contract/v1/primitives";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { PREVIEW_LIMITS } from "./limits";
export const PREVIEW_RENDERER_V2 = Object.freeze({
  id: "studio-structured-composed",
  version: "1.0.0",
} as const);
export const PREVIEW_LIMITS_V2 = Object.freeze({
  ...PREVIEW_LIMITS,
  revealResponseBytes: 524288,
});
export const previewBindingV2Schema = previewScopeSchema.extend({
  schemaVersion: z.literal("quizforge.preview-binding.v2"),
  canonicalContentSha256: sha256Schema,
  assetSetSha256: sha256Schema,
  renderer: z.strictObject({
    id: z.literal(PREVIEW_RENDERER_V2.id),
    version: z.literal(PREVIEW_RENDERER_V2.version),
  }),
  font: structuredFontIdentityV2Schema,
});
const structured = (d: {
  presentationMode: string;
  exports: { posterPng: boolean; fullReportPng: boolean };
}) =>
  d.presentationMode === "structured-only" &&
  !d.exports.posterPng &&
  !d.exports.fullReportPng;
export const temporaryPreviewEntryV2Schema = z
  .strictObject({
    kind: z.literal("temporary-preview"),
    binding: previewBindingV2Schema,
    entry: displayEntryBodyV2Schema,
  })
  .refine(
    (v) =>
      structured(v.entry) &&
      v.entry.product.productId === v.binding.productId &&
      v.entry.canonicalContentSha256 === v.binding.canonicalContentSha256,
  );
export const temporaryPreviewRequestV2Schema = z.strictObject({
  binding: previewBindingV2Schema,
  requestId: consumerUuidSchema,
  answers: consumerAnswersSchema.refine((answers) => answers.length > 0),
  matchingContext: matchingContextV1Schema,
});
export const temporaryPreviewResultV2Schema = z
  .strictObject({
    kind: z.literal("temporary-preview"),
    binding: previewBindingV2Schema,
    requestId: consumerUuidSchema,
    result: resultDisplaySnapshotV2Schema,
  })
  .refine(
    (v) =>
      structured(v.result) &&
      v.result.selectedResultRef.productId === v.binding.productId &&
      v.result.canonicalContentSha256 === v.binding.canonicalContentSha256,
  );
export const currentPreviewResponseSchema = z
  .strictObject({
    ok: z.literal(true),
    value: z.discriminatedUnion("mode", [
      z.strictObject({
        mode: z.literal("legacy"),
        binding: previewBindingSchema,
      }),
      z.strictObject({
        mode: z.literal("structured"),
        value: temporaryPreviewEntryV2Schema,
      }),
    ]),
  })
  .refine(
    (v) =>
      new TextEncoder().encode(JSON.stringify(v)).byteLength <=
      PREVIEW_LIMITS_V2.entryResponseBytes,
  );
export const temporaryPreviewResultResponseV2Schema = z
  .strictObject({ ok: z.literal(true), value: temporaryPreviewResultV2Schema })
  .refine(
    (v) =>
      new TextEncoder().encode(JSON.stringify(v)).byteLength <=
      PREVIEW_LIMITS_V2.revealResponseBytes,
  );
export const samePreviewBindingV2 = (a: unknown, b: unknown) =>
  sameConsumerFact(a, b, 8192);
export type PreviewBindingV2 = z.infer<typeof previewBindingV2Schema>;
export type TemporaryPreviewEntryV2 = z.infer<
  typeof temporaryPreviewEntryV2Schema
>;
export type TemporaryPreviewRequestV2 = z.infer<
  typeof temporaryPreviewRequestV2Schema
>;
export type TemporaryPreviewResultV2 = z.infer<
  typeof temporaryPreviewResultV2Schema
>;
export type CurrentPreviewSelection = z.infer<
  typeof currentPreviewResponseSchema
>["value"];
