import { z } from "zod";
import {
  assessmentIdSchema as id,
  assessmentReferenceSchema as ref,
  assessmentVersionSchema as version,
  sha256Schema,
} from "./primitives";
import { matchingContextV1Schema } from "./matching-v1";
import { engineDeclarationV2Schema, SCORING_LIMITS_V2 } from "./scoring-v2";

export const scoringAnswersV2Schema = z
  .array(z.strictObject({ questionId: id, optionId: id }))
  .max(SCORING_LIMITS_V2.questions);
export const scoringInputV2Schema = z.strictObject({
  schemaVersion: z.literal("quiz-scoring-input.v2"),
  answers: scoringAnswersV2Schema,
  matchingContext: matchingContextV1Schema,
});
const fraction = z.strictObject({
  numerator: z.string().regex(/^\d{1,20}$/),
  denominator: z.string().regex(/^[1-9]\d{0,19}$/),
});
const ranked = z.strictObject({
  resultRef: ref,
  totalAbsoluteDistance: z.number().int().min(0).max(1600),
  meanAbsoluteDistance: fraction,
  narrativeIndex: z.number().int().min(0).max(100),
});
export const scoreSnapshotV2Schema = z.strictObject({
  schemaVersion: z.literal("quiz-score.v2"),
  productId: id,
  contentVersion: version,
  engine: engineDeclarationV2Schema,
  logicHash: sha256Schema,
  answersHash: sha256Schema,
  inputHash: sha256Schema,
  matchingContextSha256: sha256Schema,
  matchingContext: matchingContextV1Schema,
  normalizedAnswers: scoringAnswersV2Schema,
  dimensions: z
    .array(
      z.strictObject({
        dimensionRef: ref,
        raw: z.number().int().min(-10000).max(10000),
        normalized: fraction,
        score: z.number().int().min(0).max(100),
      }),
    )
    .min(1)
    .max(SCORING_LIMITS_V2.dimensions),
  decision: z.strictObject({
    kind: z.literal("mean-l1"),
    candidateCount: z.number().int().min(1).max(SCORING_LIMITS_V2.results),
    rankings: z.array(ranked).min(1).max(SCORING_LIMITS_V2.results),
    selectedResultRef: ref,
    runnerUpResultRef: ref.nullable(),
    gapTotal: z.number().int().min(0).max(1600).nullable(),
    status: z.enum(["single-candidate", "near-tie", "distinct"]),
  }),
});
export type ScoreSnapshotV2 = z.infer<typeof scoreSnapshotV2Schema>;
export type ScoringInputV2 = z.infer<typeof scoringInputV2Schema>;
export type V2ErrorCode =
  | "INVALID_DEFINITION"
  | "INVALID_INPUT"
  | "INPUT_LIMIT_EXCEEDED"
  | "REFERENCE_MISMATCH"
  | "INVALID_NORMALIZATION_BOUNDS"
  | "INVALID_PREPARED_DEFINITION"
  | "INVALID_ANSWERS"
  | "EMPTY_CANDIDATE_POOL"
  | "INVALID_CONTENT"
  | "INVALID_REPORT_RULES"
  | "SOURCE_MISMATCH";
export type V2Result<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly issues: readonly { readonly code: V2ErrorCode }[];
    };
