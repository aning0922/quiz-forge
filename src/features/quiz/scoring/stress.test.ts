import { describe, expect, it } from "vitest";
import {
  COVERAGE_POLICY,
  coverageEvidenceSchema,
  type ScoringResult,
} from "@/lib/assessment-contract/scoring-api-v1";
import {
  prepareScoringDefinition,
  scoreCompleteAnswers,
  analyzeDimensionsCoverage,
} from "./index";
import {
  coverageStress,
  largeDenominatorDefinition,
  LARGE_PRIME_SPANS,
} from "./fixtures/stress";

function good<T>(r: ScoringResult<T>): T {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("TEST_EXPECTED_SUCCESS");
  return r.value;
}
describe("actual fixed-policy exits and exact large denominator arithmetic", () => {
  it.each(["frontier", "transitions", "comparisons"] as const)(
    "halts the real %s model inside its frozen policy",
    (kind) => {
      const result = good(
        analyzeDimensionsCoverage(
          good(prepareScoringDefinition(coverageStress(kind))),
        ),
      );
      expect(coverageEvidenceSchema.safeParse(result).success).toBe(true);
      expect(result).toMatchObject({
        status: "inconclusive",
        limit:
          kind === "frontier"
            ? "frontierStates"
            : kind === "transitions"
              ? "transitions"
              : "scalarComparisons",
      });
      expect(result.stats.transitions).toBeLessThanOrEqual(
        COVERAGE_POLICY.transitions,
      );
      expect(result.stats.coordinateAdditions).toBeLessThanOrEqual(
        COVERAGE_POLICY.coordinateAdditions,
      );
      expect(result.stats.scalarComparisons).toBeLessThanOrEqual(
        COVERAGE_POLICY.scalarComparisons,
      );
      expect(result.stats.peakFrontierStates).toBeLessThanOrEqual(
        COVERAGE_POLICY.frontierStates,
      );
      expect(result.stats.peakRetainedStates).toBeLessThanOrEqual(
        COVERAGE_POLICY.retainedStates,
      );
      expect(result.stats.peakPathBytes).toBeLessThanOrEqual(
        COVERAGE_POLICY.pathBytes,
      );
      if (kind === "transitions")
        expect(result.processedQuestions).toBeLessThan(100);
      else expect(result.processedQuestions).toBe(kind === "frontier" ? 4 : 5);
    },
    20000,
  );
  it("matches a separate pairwise-fraction oracle with a denominator far beyond Number safe integer", () => {
    const d = largeDenominatorDefinition();
    const h = good(prepareScoringDefinition(d));
    const answers = d.questions.map((q, qi) => ({
      questionId: q.ref.id,
      optionId: q.options[qi % 3 === 0 ? 1 : 0]!.ref.id,
    }));
    const score = good(scoreCompleteAnswers(h, answers));
    if (score.decision.kind !== "archetype")
      throw new Error("TEST_EXPECTED_ARCHETYPE");
    // Independent ordinary fraction addition (not the engine's common-LCM algorithm).
    const reduce = (n: bigint, den: bigint): [bigint, bigint] => {
      let a = n,
        b = den;
      while (b !== BigInt(0)) [a, b] = [b, a % b];
      return [n / a, den / a];
    };
    const expected = [0, 100].map((target) => {
      let total: [bigint, bigint] = [BigInt(0), BigInt(1)];
      for (const [di, span] of LARGE_PRIME_SPANS.entries()) {
        const selected = d.questions.map(
          (q, qi) => q.options[qi % 3 === 0 ? 1 : 0]!.contributions[di]!.value,
        );
        const minimum = d.questions.reduce(
          (s, q) =>
            s + Math.min(...q.options.map((o) => o.contributions[di]!.value)),
          0,
        );
        const n = BigInt(
          100 * (selected.reduce((a, b) => a + b, 0) - minimum) - target * span,
        );
        const den = BigInt(span);
        total = reduce(
          total[0] * den * den + n * n * total[1],
          total[1] * den * den,
        );
      }
      return { numerator: String(total[0]), denominator: String(total[1]) };
    });
    expect(score.decision.distances.map((v) => v.value)).toEqual(expected);
    expect(expected[0]!.denominator.length).toBeGreaterThan(100);
    expect(
      expected.every(
        (v) => v.numerator.length <= 160 && v.denominator.length <= 160,
      ),
    ).toBe(true);
    expect(score.decision.selectedResultRef.id).toBe("low");
  });
});
