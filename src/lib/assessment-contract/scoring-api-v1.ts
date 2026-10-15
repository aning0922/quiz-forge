import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalOrdinaryJson } from "@/lib/json/canonical";
import {
  assessmentIdSchema,
  assessmentVersionSchema,
  assessmentReferenceSchema as ref,
  engineDeclarationSchema,
  sha256Schema,
} from "./primitives";
import {
  dimensionContributionSchema,
  scoringRulesSchema,
  SCORING_LIMITS,
} from "./scoring-v1";

export const SCORING_API_LIMITS = Object.freeze({
  definitionBytes: 2 * 1024 * 1024,
  answersBytes: 64 * 1024,
  witnessesBytes: 2 * 1024 * 1024,
  scoreBytes: 64 * 1024,
  evidenceBytes: 2 * 1024 * 1024,
  authoringReviewBytes: 2 * 1024 * 1024,
  depth: 32,
  issues: 32,
  fractionDigits: 160,
});

export const SCORING_HASH_DOMAINS = Object.freeze({
  logic: "quizforge:quiz-logic.v1\n",
  answers: "quizforge:quiz-answers.v1\n",
  witnesses: "quizforge:quiz-witnesses.v1\n",
  policy: "quizforge:quiz-policy.v1\n",
  transcription: "quizforge:quiz-authoring-transcription.v1\n",
});

export const scoringDefinitionSchema = z.strictObject({
  schemaVersion: z.literal("quiz-scoring-definition.v1"),
  productId: assessmentIdSchema,
  contentVersion: assessmentVersionSchema,
  engine: engineDeclarationSchema,
  dimensions: z.array(ref).min(1).max(SCORING_LIMITS.dimensions),
  questions: z
    .array(
      z.strictObject({
        ref,
        options: z
          .array(
            z.strictObject({
              ref,
              contributions: z
                .array(dimensionContributionSchema)
                .min(1)
                .max(SCORING_LIMITS.dimensions),
            }),
          )
          .min(2)
          .max(SCORING_LIMITS.optionsPerQuestion),
      }),
    )
    .min(1)
    .max(SCORING_LIMITS.questions),
  results: z.array(ref).min(1).max(SCORING_LIMITS.results),
  rules: scoringRulesSchema,
});
export const scoringAnswerSchema = z.strictObject({
  questionId: assessmentIdSchema,
  optionId: assessmentIdSchema,
});
// Completeness and ownership depend on the prepared definition, not this shape.
export const scoringAnswersSchema = z
  .array(scoringAnswerSchema)
  .max(SCORING_LIMITS.questions);

export const scoringErrorCodeSchema = z.enum([
  "INPUT_LIMIT_EXCEEDED",
  "UNSUPPORTED_LOGIC_SCHEMA",
  "UNSUPPORTED_ENGINE",
  "INVALID_DEFINITION",
  "REFERENCE_MISMATCH",
  "INVALID_NORMALIZATION_BOUNDS",
  "INVALID_PREPARED_DEFINITION",
  "INVALID_ANSWERS",
  "NO_PROFILE_MATCH",
  "INVALID_WITNESS_SET",
  "WITNESS_RESULT_MISMATCH",
  "UNSUPPORTED_COVERAGE_ENGINE",
]);
export const scoringIssueSchema = z.strictObject({
  code: scoringErrorCodeSchema,
  // Implementations only emit fixed field names and bounded indices.
  path: z
    .array(
      z.union([
        z.enum([
          "schemaVersion",
          "productId",
          "contentVersion",
          "engine",
          "id",
          "version",
          "dimensions",
          "questions",
          "ref",
          "options",
          "contributions",
          "dimensionRef",
          "value",
          "results",
          "rules",
          "aggregation",
          "normalization",
          "kind",
          "bounds",
          "min",
          "max",
          "tieBreak",
          "resultOrder",
          "profiles",
          "resultRef",
          "ranges",
          "targets",
          "distance",
          "answers",
          "questionId",
          "optionId",
          "entries",
          "expectedResultRef",
          "definition",
          "witnesses",
          "source",
          "commit",
          "path",
          "sha256",
          "status",
          "transcriptionSha256",
        ]),
        z.number().int().min(0).max(1_000_000),
      ]),
    )
    .max(SCORING_API_LIMITS.depth),
});
export const scoringFailureSchema = z.strictObject({
  ok: z.literal(false),
  issues: z.array(scoringIssueSchema).min(1).max(SCORING_API_LIMITS.issues),
  issuesTruncated: z.boolean(),
});

const numeratorPattern = /^(0|[1-9][0-9]{0,159})$/;
const denominatorPattern = /^[1-9][0-9]{0,159}$/;
export const scoreFractionSchema = z
  .strictObject({
    numerator: z.string().regex(numeratorPattern),
    denominator: z.string().regex(denominatorPattern),
  })
  .superRefine((value, context) => {
    if (
      !numeratorPattern.test(value.numerator) ||
      !denominatorPattern.test(value.denominator)
    )
      return;
    let n = BigInt(value.numerator),
      d = BigInt(value.denominator);
    while (d !== BigInt(0)) [n, d] = [d, n % d];
    if (n !== BigInt(1))
      context.addIssue({
        code: "custom",
        message: "Fraction must be reduced.",
      });
  });
const raw = z.number().int().min(-10000).max(10000);
export const scoreDimensionSchema = z.strictObject({
  dimensionRef: ref,
  rawSum: raw,
  bounds: z.strictObject({ min: raw, max: raw }),
  normalized: scoreFractionSchema,
});
const dimensions = z
  .array(scoreDimensionSchema)
  .min(1)
  .max(SCORING_LIMITS.dimensions);
export const scoringIdentitySchema = z.strictObject({
  productId: assessmentIdSchema,
  contentVersion: assessmentVersionSchema,
  engine: engineDeclarationSchema,
  logicHash: sha256Schema,
});
export const scoreSnapshotSchema = z.strictObject({
  schemaVersion: z.literal("quiz-score.v1"),
  ...scoringIdentitySchema.shape,
  answersHash: sha256Schema,
  normalizedAnswers: scoringAnswersSchema.min(1),
  dimensions,
  decision: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("dimensions"),
      matchingResultRefs: z.array(ref).min(1).max(SCORING_LIMITS.results),
      selectedResultRef: ref,
      tieBreak: z.literal("result-order"),
    }),
    z.strictObject({
      kind: z.literal("archetype"),
      distances: z
        .array(z.strictObject({ resultRef: ref, value: scoreFractionSchema }))
        .min(1)
        .max(SCORING_LIMITS.results),
      tiedMinimumResultRefs: z.array(ref).min(1).max(SCORING_LIMITS.results),
      selectedResultRef: ref,
      tieBreak: z.literal("result-order"),
    }),
  ]),
});

export const witnessInputSchema = z.strictObject({
  schemaVersion: z.literal("quiz-witness-input.v1"),
  entries: z
    .array(
      z.strictObject({
        expectedResultRef: ref,
        answers: scoringAnswersSchema,
      }),
    )
    .min(1)
    .max(SCORING_LIMITS.results),
});
export const WITNESS_POLICY = Object.freeze({
  schemaVersion: "quiz-witness-policy.v1",
  id: "declared-witnesses.v1",
  completeSet: true,
  answerOrder: "question-order",
  resultOrder: "rule-result-order",
  maxWitnesses: 32,
  maxInputBytes: 2097152,
  maxOutputBytes: 2097152,
} as const);
export const COVERAGE_POLICY = Object.freeze({
  schemaVersion: "quiz-coverage-policy.v1",
  id: "dimensions-coverage.v1",
  algorithm: "reachable-raw-vectors-dp",
  globalProfile: "last-only",
  frontierStates: 20000,
  retainedStates: 40000,
  transitions: 1000000,
  coordinateAdditions: 16000000,
  scalarComparisons: 10000000,
  pathBytes: 4000000,
} as const);
const policyHash = (value: unknown) =>
  createHash("sha256")
    .update(SCORING_HASH_DOMAINS.policy)
    .update(canonicalOrdinaryJson(value, { maxBytes: 4096, maxDepth: 4 }))
    .digest("hex");
export const WITNESS_POLICY_HASH = policyHash(WITNESS_POLICY);
export const COVERAGE_POLICY_HASH = policyHash(COVERAGE_POLICY);
const witnessSelection = {
  expectedResultRef: ref,
  selectedResultRef: ref,
  answersHash: sha256Schema,
  dimensions,
};
const invalidWitnessIssueSchema = scoringIssueSchema.extend({
  code: z.enum(["INVALID_ANSWERS", "NO_PROFILE_MATCH"]),
});
const sameRef = (a: z.infer<typeof ref>, b: z.infer<typeof ref>) =>
  a.id === b.id && a.productId === b.productId && a.version === b.version;
export const witnessEvidenceEntrySchema = z
  .discriminatedUnion("status", [
    z.strictObject({ status: z.literal("passed"), ...witnessSelection }),
    z.strictObject({
      status: z.literal("mismatch"),
      ...witnessSelection,
      code: z.literal("WITNESS_RESULT_MISMATCH"),
    }),
    z.strictObject({
      status: z.literal("invalid"),
      expectedResultRef: ref,
      issues: z
        .array(invalidWitnessIssueSchema)
        .min(1)
        .max(SCORING_API_LIMITS.issues),
      issuesTruncated: z.boolean(),
    }),
  ])
  .superRefine((value, context) => {
    const coherent =
      value.status === "invalid"
        ? value.issues.every((issue) => issue.code === value.issues[0]?.code)
        : (value.status === "passed") ===
          sameRef(value.expectedResultRef, value.selectedResultRef);
    if (!coherent)
      context.addIssue({ code: "custom", message: "Witness entry disagrees." });
  });
export const witnessEvidenceSchema = z
  .strictObject({
    schemaVersion: z.literal("quiz-witness-evidence.v1"),
    logicHash: sha256Schema,
    inputSha256: sha256Schema,
    witnessesHash: sha256Schema.nullable(),
    policyId: z.literal(WITNESS_POLICY.id),
    policyHash: z.literal(WITNESS_POLICY_HASH),
    status: z.enum(["passed", "failed"]),
    entries: z
      .array(witnessEvidenceEntrySchema)
      .min(1)
      .max(SCORING_LIMITS.results),
  })
  .superRefine((value, context) => {
    const invalidAnswers = value.entries.some(
      (entry) =>
        entry.status === "invalid" &&
        entry.issues.some((issue) => issue.code === "INVALID_ANSWERS"),
    );
    if (
      (value.status === "passed") !==
        value.entries.every((entry) => entry.status === "passed") ||
      (value.witnessesHash === null) !== invalidAnswers
    )
      context.addIssue({
        code: "custom",
        message: "Witness status disagrees.",
      });
  });

export const coveragePolicySchema = z.strictObject({
  schemaVersion: z.literal(COVERAGE_POLICY.schemaVersion),
  id: z.literal(COVERAGE_POLICY.id),
  algorithm: z.literal(COVERAGE_POLICY.algorithm),
  globalProfile: z.literal(COVERAGE_POLICY.globalProfile),
  frontierStates: z.literal(COVERAGE_POLICY.frontierStates),
  retainedStates: z.literal(COVERAGE_POLICY.retainedStates),
  transitions: z.literal(COVERAGE_POLICY.transitions),
  coordinateAdditions: z.literal(COVERAGE_POLICY.coordinateAdditions),
  scalarComparisons: z.literal(COVERAGE_POLICY.scalarComparisons),
  pathBytes: z.literal(COVERAGE_POLICY.pathBytes),
});
const count = (maximum: number) => z.number().int().min(0).max(maximum);
const coverageCommon = {
  schemaVersion: z.literal("quiz-coverage-evidence.v1"),
  logicHash: sha256Schema,
  policyId: z.literal(COVERAGE_POLICY.id),
  policyHash: z.literal(COVERAGE_POLICY_HASH),
  budget: coveragePolicySchema,
  processedQuestions: count(SCORING_LIMITS.questions),
  stats: z.strictObject({
    transitions: count(COVERAGE_POLICY.transitions),
    coordinateAdditions: count(COVERAGE_POLICY.coordinateAdditions),
    scalarComparisons: count(COVERAGE_POLICY.scalarComparisons),
    peakFrontierStates: count(COVERAGE_POLICY.frontierStates),
    peakRetainedStates: count(COVERAGE_POLICY.retainedStates),
    peakPathBytes: count(COVERAGE_POLICY.pathBytes),
  }),
};
export const coverageEvidenceSchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      ...coverageCommon,
      status: z.literal("proven"),
      proof: z.discriminatedUnion("kind", [
        z.strictObject({
          kind: z.literal("exhaustive-reachable-vectors"),
          reachableVectorCount: count(COVERAGE_POLICY.frontierStates).min(1),
        }),
        z.strictObject({
          kind: z.literal("last-global-profile"),
          resultRef: ref,
        }),
      ]),
    }),
    z.strictObject({
      ...coverageCommon,
      status: z.literal("uncovered"),
      counterexample: z.strictObject({
        normalizedAnswers: scoringAnswersSchema.min(1),
        rawSums: z
          .array(z.strictObject({ dimensionRef: ref, rawSum: raw }))
          .min(1)
          .max(SCORING_LIMITS.dimensions),
      }),
    }),
    z.strictObject({
      ...coverageCommon,
      status: z.literal("inconclusive"),
      limit: z.enum([
        "frontierStates",
        "retainedStates",
        "transitions",
        "coordinateAdditions",
        "scalarComparisons",
        "pathBytes",
      ]),
    }),
  ])
  .superRefine((value, context) => {
    if (value.status === "proven") {
      const coherent =
        value.proof.kind === "last-global-profile"
          ? value.processedQuestions === 0
          : value.processedQuestions > 0;
      if (!coherent)
        context.addIssue({
          code: "custom",
          message: "Coverage proof count disagrees.",
        });
    }
    if (value.status === "uncovered") {
      const answers = value.counterexample.normalizedAnswers;
      if (
        answers.length !== value.processedQuestions ||
        new Set(answers.map((answer) => answer.questionId)).size !==
          answers.length
      )
        context.addIssue({
          code: "custom",
          message: "Counterexample count disagrees.",
        });
    }
  });

export type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
export type ScoringDefinitionV1 = DeepReadonly<
  z.infer<typeof scoringDefinitionSchema>
>;
export type ScoringAnswer = DeepReadonly<z.infer<typeof scoringAnswerSchema>>;
export type ScoringErrorCode = z.infer<typeof scoringErrorCodeSchema>;
export type ScoringIssue = DeepReadonly<z.infer<typeof scoringIssueSchema>>;
export type ScoringResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      issues: readonly ScoringIssue[];
      issuesTruncated: boolean;
    }>;
export type ScoringIdentity = DeepReadonly<
  z.infer<typeof scoringIdentitySchema>
>;
export type FractionV1 = DeepReadonly<z.infer<typeof scoreFractionSchema>>;
export type ScoreSnapshotV1 = DeepReadonly<z.infer<typeof scoreSnapshotSchema>>;
export type WitnessInputV1 = DeepReadonly<z.infer<typeof witnessInputSchema>>;
export type WitnessEvidenceV1 = DeepReadonly<
  z.infer<typeof witnessEvidenceSchema>
>;
export type CoverageEvidenceV1 = DeepReadonly<
  z.infer<typeof coverageEvidenceSchema>
>;
