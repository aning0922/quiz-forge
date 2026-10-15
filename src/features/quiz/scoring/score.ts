import {
  SCORING_API_LIMITS,
  SCORING_HASH_DOMAINS,
  scoringAnswersSchema,
  scoreSnapshotSchema,
  type ScoringAnswer,
  type ScoringResult,
  type ScoreSnapshotV1,
} from "@/lib/assessment-contract/scoring-api-v1";
import type { PreparedScoringDefinition } from "./contracts";
import { compiled, type Compiled } from "./prepare";
import { digest, failure, output, shapeFailure, snapshot } from "./boundary";
import { fraction, lcm, UNIT } from "./rational";

export function normalizeAnswers(
  c: Compiled,
  input: unknown,
): ScoringResult<readonly ScoringAnswer[]> {
  const copied = snapshot(
    input,
    SCORING_API_LIMITS.answersBytes,
    "INVALID_ANSWERS",
  );
  if (!copied.ok) return copied;
  const parsed = scoringAnswersSchema.safeParse(copied.value);
  if (!parsed.success) return shapeFailure(parsed.error, "INVALID_ANSWERS");
  if (parsed.data.length !== c.definition.questions.length)
    return failure("INVALID_ANSWERS", ["answers"]);
  const answers = new Map<string, ScoringAnswer>();
  for (const [i, answer] of parsed.data.entries()) {
    const option = c.options.get(answer.optionId);
    if (
      !option ||
      c.definition.questions[option.questionIndex]!.ref.id !==
        answer.questionId ||
      answers.has(answer.questionId)
    )
      return failure("INVALID_ANSWERS", ["answers", i]);
    answers.set(answer.questionId, answer);
  }
  return {
    ok: true,
    value: c.definition.questions.map((q) => answers.get(q.ref.id)!),
  };
}
export function answersHash(c: Compiled, answers: readonly ScoringAnswer[]) {
  return digest(
    {
      schemaVersion: "quiz-answers.v1",
      logicHash: c.identity.logicHash,
      answers,
    },
    SCORING_HASH_DOMAINS.answers,
  );
}
export function scoreCompleteAnswers(
  handle: PreparedScoringDefinition,
  input: unknown,
): ScoringResult<ScoreSnapshotV1> {
  const c = compiled(handle);
  if (!c) return failure("INVALID_PREPARED_DEFINITION");
  const normalized = normalizeAnswers(c, input);
  if (!normalized.ok) return normalized;
  const answers = normalized.value;
  const raw = c.definition.dimensions.map((_dim, di) =>
    answers.reduce((sum, a) => sum + c.options.get(a.optionId)!.values[di]!, 0),
  );
  const spans = c.maxima.map((max, i) => BigInt(max - c.minima[i]!));
  const numerators = raw.map((r, i) => BigInt(100) * BigInt(r - c.minima[i]!));
  const dimensions = c.definition.dimensions.map((dimensionRef, i) => ({
    dimensionRef,
    rawSum: raw[i]!,
    bounds: { min: c.minima[i]!, max: c.maxima[i]! },
    normalized: fraction(numerators[i]!, spans[i]!),
  }));
  const rules = c.definition.rules;
  let decision: ScoreSnapshotV1["decision"];
  if (rules.kind === "dimensions") {
    const matching = rules.profiles
      .filter((p) =>
        p.ranges.every(
          (r, i) =>
            numerators[i]! >= BigInt(r.min) * spans[i]! &&
            numerators[i]! <= BigInt(r.max) * spans[i]!,
        ),
      )
      .map((p) => p.resultRef);
    if (!matching.length) return failure("NO_PROFILE_MATCH");
    decision = {
      kind: "dimensions",
      matchingResultRefs: matching,
      selectedResultRef: matching[0]!,
      tieBreak: "result-order",
    };
  } else {
    const common = spans.reduce(lcm, UNIT);
    const scaled = numerators.map((n, i) => n * (common / spans[i]!));
    const distances = rules.profiles.map((p) =>
      p.targets.reduce((sum, t, i) => {
        const delta = scaled[i]! - BigInt(t.value) * common;
        return sum + delta * delta;
      }, BigInt(0)),
    );
    const minimum = distances.reduce((a, b) => (a < b ? a : b));
    const tied = rules.profiles
      .filter((_p, i) => distances[i] === minimum)
      .map((p) => p.resultRef);
    decision = {
      kind: "archetype",
      distances: rules.profiles.map((p, i) => ({
        resultRef: p.resultRef,
        value: fraction(distances[i]!, common * common),
      })),
      tiedMinimumResultRefs: tied,
      selectedResultRef: tied[0]!,
      tieBreak: "result-order",
    };
  }
  return output(
    scoreSnapshotSchema,
    {
      schemaVersion: "quiz-score.v1",
      ...c.identity,
      answersHash: answersHash(c, answers),
      normalizedAnswers: answers,
      dimensions,
      decision,
    },
    SCORING_API_LIMITS.scoreBytes,
  );
}
