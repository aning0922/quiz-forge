import {
  scoringInputV2Schema,
  scoreSnapshotV2Schema,
  type ScoreSnapshotV2,
  type V2Result,
} from "@/lib/assessment-contract/scoring-api-v2";
import { SCORING_LIMITS_V2 } from "@/lib/assessment-contract/scoring-v2";
import {
  canonicalV2,
  digestV2,
  failure,
  fraction,
  freeze,
  parseBounded,
  refKey,
  roundEven,
} from "./boundary";
import { readFixedV2, type PreparedScoringV2 } from "./prepare";

export function scoreCompleteAnswersV2(
  handle: PreparedScoringV2,
  input: unknown,
): V2Result<ScoreSnapshotV2> {
  const fixed = readFixedV2(handle);
  if (!fixed) return failure("INVALID_PREPARED_DEFINITION");
  const parsed = parseBounded(
    scoringInputV2Schema,
    input,
    "INVALID_INPUT",
    SCORING_LIMITS_V2.inputBytes,
  );
  if (!parsed.ok) return parsed;
  const d = fixed.definition;
  const { answers, matchingContext } = parsed.value;
  if (refKey(matchingContext.policyRef) !== refKey(d.matchingPolicy.ref))
    return failure("REFERENCE_MISMATCH");
  const byQuestion = new Map(answers.map((a) => [a.questionId, a.optionId]));
  if (
    answers.length !== d.questions.length ||
    byQuestion.size !== answers.length
  )
    return failure("INVALID_ANSWERS");
  const choices = d.questions.map((q) =>
    q.options.find((o) => o.ref.id === byQuestion.get(q.ref.id)),
  );
  if (choices.some((o) => !o)) return failure("INVALID_ANSWERS");
  const normalizedAnswers = d.questions.map((q, i) => ({
    questionId: q.ref.id,
    optionId: choices[i]!.ref.id,
  }));
  const dimensions = d.dimensions.map((dimension) => {
    const raw = choices.reduce(
      (sum, o) =>
        sum +
        o!.contributions.find(
          (c) => refKey(c.dimensionRef) === refKey(dimension.ref),
        )!.value,
      0,
    );
    const numerator = (raw - dimension.min) * 100;
    const denominator = dimension.max - dimension.min;
    return {
      dimensionRef: dimension.ref,
      raw,
      normalized: fraction(numerator, denominator),
      score: Number(roundEven(BigInt(numerator), BigInt(denominator))),
    };
  });
  const eligible = d.profiles.filter(
    (p) =>
      d.matchingPolicy.allowedKinds.includes(p.kind) &&
      (matchingContext.preference === "any" ||
        p.sex === matchingContext.preference),
  );
  if (!eligible.length) return failure("EMPTY_CANDIDATE_POOL");
  const rankings = eligible
    .map((p) => {
      const total = dimensions.reduce(
        (sum, dim) =>
          sum +
          Math.abs(
            dim.score -
              p.targets.find(
                (t) => refKey(t.dimensionRef) === refKey(dim.dimensionRef),
              )!.value,
          ),
        0,
      );
      const index = Number(
        roundEven(
          BigInt(200 * dimensions.length - 3 * total),
          BigInt(2 * dimensions.length),
        ),
      );
      return {
        stableRankKey: p.stableRankKey,
        resultRef: p.resultRef,
        totalAbsoluteDistance: total,
        meanAbsoluteDistance: fraction(total, dimensions.length),
        narrativeIndex: Math.max(0, Math.min(100, index)),
      };
    })
    .sort(
      (a, b) =>
        a.totalAbsoluteDistance - b.totalAbsoluteDistance ||
        Buffer.compare(
          Buffer.from(a.stableRankKey, "ascii"),
          Buffer.from(b.stableRankKey, "ascii"),
        ),
    );
  const first = rankings[0]!,
    second = rankings[1];
  const gapTotal = second
    ? second.totalAbsoluteDistance - first.totalAbsoluteDistance
    : null;
  const value = scoreSnapshotV2Schema.parse({
    schemaVersion: "quiz-score.v2",
    productId: d.productId,
    contentVersion: d.contentVersion,
    engine: d.engine,
    logicHash: fixed.logicHash,
    answersHash: digestV2("quiz-answers.v2", normalizedAnswers),
    inputHash: digestV2("quiz-input.v2", {
      ...parsed.value,
      answers: normalizedAnswers,
    }),
    matchingContextSha256: digestV2(
      "quiz-matching-context.v1",
      matchingContext,
    ),
    matchingContext,
    normalizedAnswers,
    dimensions,
    decision: {
      kind: "mean-l1",
      candidateCount: rankings.length,
      rankings: rankings.map((r) => ({
        resultRef: r.resultRef,
        totalAbsoluteDistance: r.totalAbsoluteDistance,
        meanAbsoluteDistance: r.meanAbsoluteDistance,
        narrativeIndex: r.narrativeIndex,
      })),
      selectedResultRef: first.resultRef,
      runnerUpResultRef: second?.resultRef ?? null,
      gapTotal,
      status: !second
        ? "single-candidate"
        : gapTotal! <= 4 * dimensions.length
          ? "near-tie"
          : "distinct",
    },
  });
  try {
    canonicalV2(value, SCORING_LIMITS_V2.outputBytes);
  } catch {
    return failure("INPUT_LIMIT_EXCEEDED");
  }
  return freeze({ ok: true, value });
}
