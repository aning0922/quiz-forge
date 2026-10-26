import { z } from "zod";
import { assessmentReferenceSchema as ref } from "./primitives";

/** A preference about the result, never a statement about the respondent. */
export const matchingPreferenceSchema = z.enum(["male", "female", "any"]);
export const matchingContextV1Schema = z.strictObject({
  schemaVersion: z.literal("quiz-matching-context.v1"),
  preference: matchingPreferenceSchema,
  policyRef: ref,
});
export const matchingPolicyV1Schema = z.strictObject({
  ref,
  allowedKinds: z
    .array(z.enum(["documented-historical", "literary-legendary"]))
    .min(1)
    .max(2),
});
export type MatchingContextV1 = z.infer<typeof matchingContextV1Schema>;
