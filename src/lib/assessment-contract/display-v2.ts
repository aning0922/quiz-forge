import { z } from "zod";
import {
  assessmentIdSchema,
  assessmentReferenceSchema as ref,
  assessmentVersionSchema,
  sha256Schema,
} from "./primitives";
import { matchingPreferenceSchema } from "./matching-v1";
import { presentationSlotsV3Schema } from "./presentation-v3";
import { composedReportBodyV1Schema } from "./composed-report-v1";
import { displayAssetV1Schema } from "./display-v1";

const text = z.string().min(1).max(4000);
export const displayEntryBodyV2Schema = z.strictObject({
  presentationMode: z.literal("structured-only"),
  exports: z.strictObject({
    posterPng: z.literal(false),
    fullReportPng: z.literal(false),
  }),
  schemaVersion: z.literal("quiz-entry-display.v2"),
  contentSchemaVersion: z.literal("quizpack-content.v3"),
  canonicalContentSha256: sha256Schema,
  kind: z.enum(["synthetic", "authored"]),
  product: z.strictObject({ productId: assessmentIdSchema, title: text }),
  matchingPolicyRef: ref,
  preferences: z.array(matchingPreferenceSchema).length(3),
  questions: z
    .array(
      z.strictObject({
        ref,
        prompt: text,
        act: z.number().int().min(1).max(8),
        options: z
          .array(z.strictObject({ ref, label: text }))
          .min(2)
          .max(8),
      }),
    )
    .min(1)
    .max(100),
  slots: presentationSlotsV3Schema.shape.neutral,
  assets: z.array(displayAssetV1Schema).min(1).max(64),
});
export const resultDisplaySnapshotV2Schema = z.strictObject({
  presentationMode: z.literal("structured-only"),
  exports: z.strictObject({
    posterPng: z.literal(false),
    fullReportPng: z.literal(false),
  }),
  schemaVersion: z.literal("quiz-result-display.v2"),
  contentSchemaVersion: z.literal("quizpack-content.v3"),
  contentVersion: assessmentVersionSchema,
  reportVersion: assessmentVersionSchema,
  canonicalContentSha256: sha256Schema,
  logicHash: sha256Schema,
  answersHash: sha256Schema,
  inputHash: sha256Schema,
  matchingContextSha256: sha256Schema,
  selectedResultRef: ref,
  reportTemplateRef: ref,
  body: composedReportBodyV1Schema,
  bodySha256: sha256Schema,
  slots: z.strictObject({
    neutral: presentationSlotsV3Schema.shape.neutral,
    character: presentationSlotsV3Schema.shape.characters.element,
  }),
  assets: z.array(displayAssetV1Schema).min(1).max(64),
});
export type DisplayEntryBodyV2 = z.infer<typeof displayEntryBodyV2Schema>;
export type ResultDisplaySnapshotV2 = z.infer<
  typeof resultDisplaySnapshotV2Schema
>;
