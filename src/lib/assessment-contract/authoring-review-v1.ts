import { z } from "zod";
import { assessmentVersionSchema, sha256Schema } from "./primitives";
import { scoringDefinitionSchema, witnessInputSchema } from "./scoring-api-v1";

// This declaration is bound by the pure module; verifying the source file is
// a separate authoring operation. No filesystem access or approval is implied.
export const authoringSourceSchema = z.strictObject({
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  path: z.literal("docs/FIRST_PRODUCT_CONTENT_DRAFT.md"),
  sha256: sha256Schema,
});
export const authoringReviewPayloadSchema = z.strictObject({
  schemaVersion: z.literal("quiz-authoring-review.v1"),
  status: z.literal("authored-pending"),
  source: authoringSourceSchema,
  definition: scoringDefinitionSchema,
  witnesses: witnessInputSchema,
});
export const authoringReviewSchema = authoringReviewPayloadSchema.extend({
  transcriptionSha256: sha256Schema,
});
export const scoringSourceBindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("content"),
    contentSchemaVersion: z.enum([
      "quizpack-content.v1",
      "quizpack-content.v2",
    ]),
    contentVersion: assessmentVersionSchema,
    canonicalContentSha256: sha256Schema,
  }),
  z.strictObject({
    kind: z.literal("authoring-review"),
    source: authoringSourceSchema,
    transcriptionSha256: sha256Schema,
  }),
]);
export type AuthoringReviewV1 = z.infer<typeof authoringReviewSchema>;
export type ScoringSourceBinding = z.infer<typeof scoringSourceBindingSchema>;
