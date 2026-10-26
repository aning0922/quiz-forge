import { z } from "zod";
import {
  assessmentIdSchema as id,
  assessmentVersionSchema as version,
  assessmentReferenceSchema as ref,
} from "./primitives";
import { matchingPolicyV1Schema } from "./matching-v1";

export const SCORING_LIMITS_V2 = Object.freeze({
  questions: 100,
  optionsPerQuestion: 8,
  dimensions: 16,
  results: 32,
  definitionBytes: 2 * 1024 * 1024,
  inputBytes: 64 * 1024,
  outputBytes: 64 * 1024,
});
export const engineDeclarationV2Schema = z.strictObject({
  id: z.literal("archetype-l1"),
  version: z.literal("1.0.0"),
});
/** ASCII only; uniqueness and byte ordering are enforced by preparation. */
export const stableRankKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,79}(?![\s\S])/);
export const scoringDefinitionV2Schema = z.strictObject({
  schemaVersion: z.literal("quiz-scoring-definition.v2"),
  productId: id,
  contentVersion: version,
  engine: engineDeclarationV2Schema,
  dimensions: z
    .array(
      z.strictObject({
        ref,
        min: z.number().int().min(-10000).max(10000),
        max: z.number().int().min(-10000).max(10000),
      }),
    )
    .min(1)
    .max(SCORING_LIMITS_V2.dimensions),
  questions: z
    .array(
      z.strictObject({
        ref,
        options: z
          .array(
            z.strictObject({
              ref,
              contributions: z
                .array(
                  z.strictObject({
                    dimensionRef: ref,
                    value: z.number().int().min(-100).max(100),
                  }),
                )
                .min(1)
                .max(SCORING_LIMITS_V2.dimensions),
            }),
          )
          .min(2)
          .max(SCORING_LIMITS_V2.optionsPerQuestion),
      }),
    )
    .min(1)
    .max(SCORING_LIMITS_V2.questions),
  profiles: z
    .array(
      z.strictObject({
        resultRef: ref,
        stableRankKey: stableRankKeySchema,
        sex: z.enum(["male", "female"]),
        kind: z.enum(["documented-historical", "literary-legendary"]),
        targets: z
          .array(
            z.strictObject({
              dimensionRef: ref,
              value: z.number().int().min(0).max(100),
            }),
          )
          .min(1)
          .max(SCORING_LIMITS_V2.dimensions),
      }),
    )
    .min(1)
    .max(SCORING_LIMITS_V2.results),
  matchingPolicy: matchingPolicyV1Schema,
  rules: z.strictObject({
    normalization: z.literal("linear-to-0-100"),
    rounding: z.literal("ties-to-even-integer"),
    distance: z.literal("mean-l1"),
    tieBreak: z.literal("stable-rank-key-ascii"),
    nearTieMeanGap: z.literal(4),
    index: z.literal("clamp-round-even-100-minus-1.5-distance"),
  }),
});
export type ScoringDefinitionV2 = z.infer<typeof scoringDefinitionV2Schema>;
