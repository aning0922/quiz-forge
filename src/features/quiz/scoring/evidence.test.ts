import { describe, expect, it } from "vitest";
import {
  COVERAGE_POLICY,
  coverageEvidenceSchema,
  witnessEvidenceSchema,
  type ScoringResult,
} from "@/lib/assessment-contract/scoring-api-v1";
import {
  prepareScoringDefinition,
  scoreCompleteAnswers,
  verifyDeclaredWitnesses,
  analyzeDimensionsCoverage,
} from "./index";
import { syntheticDefinition, syntheticAnswers } from "./fixtures/synthetic";
import {
  CoverageMeter,
  BudgetExhausted,
  type BudgetLimit,
} from "./coverage-budget";
import type { PreparedScoringDefinition } from "./contracts";
function good<T>(r: ScoringResult<T>): T {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("TEST_EXPECTED_SUCCESS");
  return r.value;
}
function witnesses() {
  const d = syntheticDefinition();
  return {
    schemaVersion: "quiz-witness-input.v1" as const,
    entries: d.results.map((expectedResultRef, i) => ({
      expectedResultRef,
      answers: syntheticAnswers(i * 2),
    })),
  };
}
describe("actual witness execution and exact input identities", () => {
  it("executes all declared witnesses, sorts only the canonical identity and freezes evidence", () => {
    const h = good(prepareScoringDefinition(syntheticDefinition()));
    const input = witnesses();
    const before = good(verifyDeclaredWitnesses(h, input));
    expect(witnessEvidenceSchema.safeParse(before).success).toBe(true);
    expect(before.status).toBe("passed");
    const reversed = {
      ...input,
      entries: [...input.entries]
        .reverse()
        .map((e) => ({ ...e, answers: [...e.answers].reverse() })),
    };
    const after = good(verifyDeclaredWitnesses(h, reversed));
    expect(after.witnessesHash).toBe(before.witnessesHash);
    expect(after.inputSha256).not.toBe(before.inputSha256);
    expect(after.entries).toEqual(before.entries);
    expect(Object.isFrozen(before.entries[0])).toBe(true);
  });
  it("distinguishes mismatch, invalid answers, and normalizable NO_PROFILE_MATCH", () => {
    const h = good(prepareScoringDefinition(syntheticDefinition()));
    const input = witnesses();
    const mismatch = {
      ...input,
      entries: input.entries.map((e) => ({
        ...e,
        answers: syntheticAnswers(),
      })),
    };
    const m = good(verifyDeclaredWitnesses(h, mismatch));
    expect(m.status).toBe("failed");
    expect(m.witnessesHash).not.toBeNull();
    expect(m.entries.map((e) => e.status)).toEqual(["passed", "mismatch"]);
    const invalid = good(
      verifyDeclaredWitnesses(h, {
        ...input,
        entries: input.entries.map((e, i) => ({
          ...e,
          answers: i ? e.answers : [],
        })),
      }),
    );
    expect(invalid.witnessesHash).toBeNull();
    expect(invalid.entries.map((e) => e.status)).toEqual(["invalid", "passed"]);
    const dh = good(
      prepareScoringDefinition(syntheticDefinition("dimensions")),
    );
    const noMatch = good(
      verifyDeclaredWitnesses(dh, {
        ...input,
        entries: input.entries.map((e, i) => ({
          ...e,
          answers: i ? e.answers : syntheticAnswers(0, 2),
        })),
      }),
    );
    expect(noMatch.status).toBe("failed");
    expect(noMatch.witnessesHash).not.toBeNull();
    expect(noMatch.entries[0]).toMatchObject({
      status: "invalid",
      issues: [{ code: "NO_PROFILE_MATCH" }],
    });
  });
  it.each(["missing", "duplicate", "foreign", "shape", "extra-field"])(
    "refuses %s set without issuing partial evidence",
    (kind) => {
      const input = structuredClone(witnesses());
      if (kind === "missing") input.entries.pop();
      if (kind === "duplicate")
        input.entries[1] = structuredClone(input.entries[0]!);
      if (kind === "foreign")
        input.entries[0]!.expectedResultRef.productId = "foreign";
      if (kind === "shape")
        input.entries[0]!.answers[0]!.questionId = "INVALID";
      if (kind === "extra-field")
        Object.assign(input.entries[0]!.answers[0]!, {
          arbitraryPrivateKey: 3,
        });
      const h = good(prepareScoringDefinition(syntheticDefinition()));
      const result = verifyDeclaredWitnesses(h, input);
      expect(result).toMatchObject({
        ok: false,
        issues: [{ code: "INVALID_WITNESS_SET" }],
      });
      expect(JSON.stringify(result)).not.toContain("arbitraryPrivateKey");
    },
  );
});
describe("fixed-budget reachable-vector coverage", () => {
  it("proves only declared last full-domain profiles structurally", () => {
    const d = syntheticDefinition("dimensions");
    if (d.rules.kind !== "dimensions")
      throw new Error("TEST_EXPECTED_DIMENSIONS");
    for (const r of d.rules.profiles[1]!.ranges) {
      r.min = 0;
      r.max = 100;
    }
    const h = good(prepareScoringDefinition(d));
    const result = good(analyzeDimensionsCoverage(h));
    expect(result).toMatchObject({
      status: "proven",
      processedQuestions: 0,
      proof: { kind: "last-global-profile", resultRef: { id: "high" } },
      stats: {
        transitions: 0,
        coordinateAdditions: 0,
        scalarComparisons: 4,
        peakPathBytes: 0,
      },
    });
    expect(coverageEvidenceSchema.safeParse(result).success).toBe(true);
  });
  it("enumerates actual reachable vectors rather than continuous-space gaps", () => {
    const d = syntheticDefinition("dimensions");
    if (d.rules.kind !== "dimensions")
      throw new Error("TEST_EXPECTED_DIMENSIONS");
    for (const r of d.rules.profiles[0]!.ranges) {
      r.min = 0;
      r.max = 100;
    }
    const result = good(
      analyzeDimensionsCoverage(good(prepareScoringDefinition(d))),
    );
    expect(result).toMatchObject({
      status: "proven",
      processedQuestions: 2,
      proof: { kind: "exhaustive-reachable-vectors", reachableVectorCount: 9 },
      stats: {
        transitions: 12,
        coordinateAdditions: 24,
        scalarComparisons: 38,
        peakFrontierStates: 9,
        peakRetainedStates: 12,
        peakPathBytes: 21,
      },
    });
    expect(Object.isFrozen(result.stats)).toBe(true);
  });
  it("only copies representative paths for newly deduplicated states", () => {
    const d = syntheticDefinition("dimensions");
    for (const o of d.questions[0]!.options)
      o.contributions[1]!.value = o.contributions[0]!.value;
    for (const o of d.questions[1]!.options)
      for (const v of o.contributions) v.value = 0;
    if (d.rules.kind !== "dimensions")
      throw new Error("TEST_EXPECTED_DIMENSIONS");
    for (const r of d.rules.profiles[0]!.ranges) {
      r.min = 0;
      r.max = 100;
    }
    const result = good(
      analyzeDimensionsCoverage(good(prepareScoringDefinition(d))),
    );
    expect(result).toMatchObject({
      status: "proven",
      proof: { kind: "exhaustive-reachable-vectors", reachableVectorCount: 3 },
      stats: {
        transitions: 12,
        peakFrontierStates: 3,
        peakRetainedStates: 6,
        peakPathBytes: 9,
      },
    });
  });
  it("returns complete actually rescored counterexample and never a partial vector", () => {
    const h = good(prepareScoringDefinition(syntheticDefinition("dimensions")));
    const result = good(analyzeDimensionsCoverage(h));
    expect(result.status).toBe("uncovered");
    if (result.status !== "uncovered")
      throw new Error("TEST_EXPECTED_COUNTEREXAMPLE");
    expect(result.processedQuestions).toBe(2);
    expect(result.stats.coordinateAdditions).toBe(28);
    expect(result.stats.scalarComparisons).toBe(22);
    expect(result.counterexample.normalizedAnswers).toHaveLength(2);
    expect(result.counterexample.rawSums.map((r) => r.rawSum)).toEqual([-2, 2]);
    expect(
      scoreCompleteAnswers(h, result.counterexample.normalizedAnswers),
    ).toMatchObject({ ok: false, issues: [{ code: "NO_PROFILE_MATCH" }] });
    expect(coverageEvidenceSchema.safeParse(result).success).toBe(true);
  });
  it("agrees with independent tiny Cartesian enumeration across 25 range models", () => {
    for (const left of [0, 25, 50, 75, 100])
      for (const right of [0, 25, 50, 75, 100]) {
        const d = syntheticDefinition("dimensions");
        if (d.rules.kind !== "dimensions")
          throw new Error("TEST_EXPECTED_DIMENSIONS");
        for (const r of d.rules.profiles[0]!.ranges) {
          r.min = 0;
          r.max = left;
        }
        for (const r of d.rules.profiles[1]!.ranges) {
          r.min = right;
          r.max = 100;
        }
        let covered = true;
        for (const x of [0, 50, 100])
          for (const y of [0, 50, 100])
            if (!((x <= left && y <= left) || (x >= right && y >= right)))
              covered = false;
        const result = good(
          analyzeDimensionsCoverage(good(prepareScoringDefinition(d))),
        );
        expect(result.status).toBe(covered ? "proven" : "uncovered");
      }
  });
  it.each(["frontierStates", "retainedStates", "pathBytes"] as const)(
    "checks %s before reserving a new state",
    (limit) => {
      const meter = new CoverageMeter({ ...COVERAGE_POLICY, [limit]: 0 });
      expect(() => meter.reserve(1, 1, 1)).toThrow(BudgetExhausted);
      try {
        meter.reserve(1, 1, 1);
      } catch (e) {
        expect(e).toMatchObject({ limit });
      }
      expect(meter.stats.peakFrontierStates).toBe(0);
      expect(meter.stats.peakRetainedStates).toBe(0);
      expect(meter.stats.peakPathBytes).toBe(0);
    },
  );
  it.each(["transitions", "coordinateAdditions", "scalarComparisons"] as const)(
    "allows exact %s exhaustion, refusing only subsequent work",
    (limit) => {
      const meter = new CoverageMeter({ ...COVERAGE_POLICY, [limit]: 2 });
      meter.take(limit, 2);
      expect(meter.stats[limit]).toBe(2);
      expect(() => meter.take(limit, 1)).toThrow(BudgetExhausted);
      expect(meter.stats[limit]).toBe(2);
    },
  );
  it("rejects forged handles and unsupported analysis without entering the DP", () => {
    const fake = {} as PreparedScoringDefinition;
    expect(analyzeDimensionsCoverage(fake)).toMatchObject({
      ok: false,
      issues: [{ code: "INVALID_PREPARED_DEFINITION" }],
    });
    expect(verifyDeclaredWitnesses(fake, witnesses())).toMatchObject({
      ok: false,
      issues: [{ code: "INVALID_PREPARED_DEFINITION" }],
    });
    expect(
      analyzeDimensionsCoverage(
        good(prepareScoringDefinition(syntheticDefinition())),
      ),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "UNSUPPORTED_COVERAGE_ENGINE" }],
    });
  });
  it("has no public policy-override argument", () => {
    const run: typeof analyzeDimensionsCoverage = analyzeDimensionsCoverage;
    expect(run.length).toBe(1);
    const name: BudgetLimit = "transitions";
    expect(COVERAGE_POLICY[name]).toBe(1000000);
  });
});
