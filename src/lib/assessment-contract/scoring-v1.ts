import { z } from "zod";
import { assessmentReferenceSchema as contentReferenceSchema } from "./primitives";

export const SCORING_LIMITS = Object.freeze({
  questions: 100,
  optionsPerQuestion: 8,
  dimensions: 16,
  results: 32,
});

export const dimensionContributionSchema = z.strictObject({
  dimensionRef: contentReferenceSchema,
  value: z.number().int().min(-100).max(100),
});
export const normalizationSchema = z.strictObject({
  kind: z.literal("linear-to-0-100"),
  bounds: z
    .array(
      z.strictObject({
        dimensionRef: contentReferenceSchema,
        min: z.number().int().min(-10000).max(10000),
        max: z.number().int().min(-10000).max(10000),
      }),
    )
    .min(1)
    .max(SCORING_LIMITS.dimensions),
});
const ruleBase = {
  aggregation: z.literal("sum"),
  normalization: normalizationSchema,
  tieBreak: z.literal("result-order"),
  resultOrder: z
    .array(contentReferenceSchema)
    .min(1)
    .max(SCORING_LIMITS.results),
};
export const scoringRulesSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...ruleBase,
    kind: z.literal("dimensions"),
    profiles: z
      .array(
        z.strictObject({
          resultRef: contentReferenceSchema,
          ranges: z
            .array(
              z.strictObject({
                dimensionRef: contentReferenceSchema,
                min: z.number().int().min(0).max(100),
                max: z.number().int().min(0).max(100),
              }),
            )
            .min(1)
            .max(SCORING_LIMITS.dimensions),
        }),
      )
      .min(1)
      .max(SCORING_LIMITS.results),
  }),
  z.strictObject({
    ...ruleBase,
    kind: z.literal("archetype"),
    distance: z.literal("squared-euclidean"),
    profiles: z
      .array(
        z.strictObject({
          resultRef: contentReferenceSchema,
          targets: z
            .array(
              z.strictObject({
                dimensionRef: contentReferenceSchema,
                value: z.number().int().min(0).max(100),
              }),
            )
            .min(1)
            .max(SCORING_LIMITS.dimensions),
        }),
      )
      .min(1)
      .max(SCORING_LIMITS.results),
  }),
]);
