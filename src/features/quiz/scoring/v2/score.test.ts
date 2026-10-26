import { describe, expect, it } from "vitest";
import type { V2Result } from "@/lib/assessment-contract/scoring-api-v2";
import {
  prepareScoringV2,
  scoreCompleteAnswersV2,
  readScoringIdentityV2,
} from "./index";
import { roundEven } from "./boundary";
import {
  syntheticV2,
  syntheticInputV2,
  syntheticRef as r,
} from "./fixtures.test-support";
function good<T>(value: V2Result<T>): T {
  expect(value.ok).toBe(true);
  if (!value.ok) throw Error("EXPECTED_SUCCESS");
  return value.value;
}
describe("versioned integer L1 scoring", () => {
  it("rounds exact positive/negative ties to even and distinguishes non-ties", () => {
    for (const [n, d, expected] of [
      [1, 2, 0],
      [3, 2, 2],
      [5, 2, 2],
      [7, 2, 4],
      [-1, 2, 0],
      [-3, 2, -2],
      [149, 100, 1],
      [151, 100, 2],
    ])
      expect(Number(roundEven(BigInt(n!), BigInt(d!)))).toBe(expected);
    const def = syntheticV2(1, 2);
    def.dimensions[0]!.min = 0;
    def.dimensions[0]!.max = 200;
    def.questions[0]!.options = [0, 1, 3, 5, 7, 100].map((value, i) => ({
      ref: r(`q-0-o-${i}`),
      contributions: [{ dimensionRef: r("axis-0"), value }],
    }));
    def.questions[1]!.options = [0, 100].map((value, i) => ({
      ref: r(`q-1-o-${i}`),
      contributions: [{ dimensionRef: r("axis-0"), value }],
    }));
    const h = good(prepareScoringV2(def));
    for (const [oi, expected] of [
      [1, 0],
      [2, 2],
      [3, 2],
      [4, 4],
    ])
      expect(
        good(scoreCompleteAnswersV2(h, syntheticInputV2(2, [oi!, 0])))
          .dimensions[0]!.score,
      ).toBe(expected);
  });
  it("uses L1 rather than squared distance, with exact means and index ties", () => {
    const d = syntheticV2();
    d.profiles[0]!.targets[0]!.value = 47;
    d.profiles[1]!.targets[0]!.value = 48;
    d.profiles[1]!.targets[1]!.value = 48;
    const score = good(
      scoreCompleteAnswersV2(good(prepareScoringV2(d)), syntheticInputV2()),
    );
    expect(
      score.decision.rankings.map((v) => [
        v.resultRef.id,
        v.totalAbsoluteDistance,
        v.meanAbsoluteDistance,
        v.narrativeIndex,
      ]),
    ).toEqual([
      ["first", 3, { numerator: "3", denominator: "2" }, 98],
      ["second", 4, { numerator: "2", denominator: "1" }, 97],
    ]);
  });
  it("orders equal distances by fixed ASCII keys, independent of profile order", () => {
    const d = syntheticV2();
    const score = good(
      scoreCompleteAnswersV2(good(prepareScoringV2(d)), syntheticInputV2()),
    );
    expect(score.decision.selectedResultRef.id).toBe("second");
    d.profiles.reverse();
    expect(
      good(
        scoreCompleteAnswersV2(good(prepareScoringV2(d)), syntheticInputV2()),
      ).decision.rankings,
    ).toEqual(score.decision.rankings);
    d.profiles[0]!.stableRankKey = d.profiles[1]!.stableRankKey;
    expect(prepareScoringV2(d).ok).toBe(false);
    for (const key of ["é", "A", "a-", "a\n", "a\r", "a\0", "a".repeat(81)]) {
      d.profiles[0]!.stableRankKey = key;
      expect(prepareScoringV2(d).ok).toBe(false);
    }
  });
  it("includes the exact near-tie boundary and rejects client policy/pool replacement", () => {
    const d = syntheticV2();
    d.profiles[1]!.targets[0]!.value = 58;
    expect(
      good(
        scoreCompleteAnswersV2(good(prepareScoringV2(d)), syntheticInputV2()),
      ).decision.status,
    ).toBe("near-tie");
    d.profiles[1]!.targets[0]!.value = 59;
    const h = good(prepareScoringV2(d));
    expect(
      good(scoreCompleteAnswersV2(h, syntheticInputV2())).decision.status,
    ).toBe("distinct");
    const input = syntheticInputV2();
    input.matchingContext.policyRef.id = "other";
    expect(scoreCompleteAnswersV2(h, input).ok).toBe(false);
    expect(
      scoreCompleteAnswersV2(h, {
        ...syntheticInputV2(),
        candidates: ["second"],
      }).ok,
    ).toBe(false);
  });
  it("filters candidates without changing dimensions; single/empty pools stay explicit", () => {
    const d = syntheticV2(),
      h = good(prepareScoringV2(d));
    const any = good(scoreCompleteAnswersV2(h, syntheticInputV2()));
    const female = good(
      scoreCompleteAnswersV2(h, syntheticInputV2(2, [1, 1], "female")),
    );
    expect(female.dimensions).toEqual(any.dimensions);
    expect(female.answersHash).toBe(any.answersHash);
    expect(female.inputHash).not.toBe(any.inputHash);
    expect(female.decision).toMatchObject({
      candidateCount: 1,
      status: "single-candidate",
      runnerUpResultRef: null,
      gapTotal: null,
    });
    d.matchingPolicy.allowedKinds = ["literary-legendary"];
    expect(
      scoreCompleteAnswersV2(good(prepareScoringV2(d)), syntheticInputV2()),
    ).toMatchObject({ ok: false, issues: [{ code: "EMPTY_CANDIDATE_POOL" }] });
  });
  it("rejects incomplete, duplicate, foreign and mismatched input", () => {
    const h = good(prepareScoringV2(syntheticV2()));
    for (const answers of [
      [],
      [{ questionId: "q-0", optionId: "q-0-o-1" }],
      [
        { questionId: "q-0", optionId: "q-0-o-1" },
        { questionId: "q-0", optionId: "q-0-o-1" },
      ],
      [
        { questionId: "q-0", optionId: "q-1-o-1" },
        { questionId: "q-1", optionId: "q-1-o-1" },
      ],
    ])
      expect(
        scoreCompleteAnswersV2(h, { ...syntheticInputV2(), answers }).ok,
      ).toBe(false);
    expect(scoreCompleteAnswersV2({} as typeof h, syntheticInputV2()).ok).toBe(
      false,
    );
  });
  it("snapshots ordinary input, freezes output and keeps separate stable identities", () => {
    const d = syntheticV2(),
      h = good(prepareScoringV2(d));
    const input = syntheticInputV2(),
      before = good(scoreCompleteAnswersV2(h, input));
    d.profiles[0]!.targets[0]!.value = 0;
    expect(good(scoreCompleteAnswersV2(h, input))).toEqual(before);
    input.answers.reverse();
    expect(good(scoreCompleteAnswersV2(h, input))).toEqual(before);
    expect(Object.isFrozen(before.decision.rankings[0])).toBe(true);
    expect(good(readScoringIdentityV2(h)).logicHash).toBe(before.logicHash);
    let accessed = false;
    expect(
      prepareScoringV2(
        Object.defineProperty({}, "schemaVersion", {
          enumerable: true,
          get() {
            accessed = true;
            return "quiz-scoring-definition.v2";
          },
        }),
      ).ok,
    ).toBe(false);
    expect(accessed).toBe(false);
    d.dimensions[0]!.min = -3;
    expect(prepareScoringV2(d).ok).toBe(false);
  });
});
