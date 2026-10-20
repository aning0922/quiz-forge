import { describe, expect, it } from "vitest";
import {
  COVERAGE_POLICY,
  COVERAGE_POLICY_HASH,
  WITNESS_POLICY,
  WITNESS_POLICY_HASH,
  coverageEvidenceSchema,
  scoreFractionSchema,
  scoringIssueSchema,
  witnessEvidenceSchema,
} from "./scoring-api-v1";
import { scoringSourceBindingSchema } from "./authoring-review-v1";

const hash = "a".repeat(64);
const ref = { id: "result-a", productId: "synthetic-test", version: "1.0.0" };
const dimension = {
  dimensionRef: { ...ref, id: "pace" },
  rawSum: -2,
  bounds: { min: -4, max: 4 },
  normalized: { numerator: "25", denominator: "1" },
};
const selected = {
  status: "passed" as const,
  expectedResultRef: ref,
  selectedResultRef: ref,
  answersHash: hash,
  dimensions: [dimension],
};
const witness = {
  schemaVersion: "quiz-witness-evidence.v1",
  logicHash: hash,
  inputSha256: hash,
  witnessesHash: hash,
  policyId: WITNESS_POLICY.id,
  policyHash: WITNESS_POLICY_HASH,
  status: "passed",
  entries: [selected],
};
const coverage = {
  schemaVersion: "quiz-coverage-evidence.v1",
  logicHash: hash,
  policyId: COVERAGE_POLICY.id,
  policyHash: COVERAGE_POLICY_HASH,
  budget: COVERAGE_POLICY,
  processedQuestions: 0,
  stats: {
    transitions: 0,
    coordinateAdditions: 0,
    scalarComparisons: 2,
    peakFrontierStates: 0,
    peakRetainedStates: 0,
    peakPathBytes: 0,
  },
  status: "proven",
  proof: { kind: "last-global-profile", resultRef: ref },
};

describe("bounded scoring evidence wire contracts", () => {
  it("accepts exact reduced values and the unique zero encoding", () => {
    for (const fraction of [
      { numerator: "0", denominator: "1" },
      { numerator: "25", denominator: "12" },
      { numerator: "9".repeat(160), denominator: "2" },
    ])
      expect(scoreFractionSchema.safeParse(fraction).success).toBe(true);
    for (const fraction of [
      { numerator: "0", denominator: "2" },
      { numerator: "2", denominator: "4" },
      { numerator: "01", denominator: "2" },
      { numerator: "-1", denominator: "2" },
      { numerator: "1", denominator: "0" },
      { numerator: "9".repeat(161), denominator: "2" },
      { numerator: "not-an-integer", denominator: "2" },
    ])
      expect(scoreFractionSchema.safeParse(fraction).success).toBe(false);
  });

  it("does not let success hide a failed witness or missing canonical identity", () => {
    expect(witnessEvidenceSchema.safeParse(witness).success).toBe(true);
    expect(
      witnessEvidenceSchema.safeParse({ ...witness, witnessesHash: null })
        .success,
    ).toBe(false);
    const invalid = {
      status: "invalid",
      expectedResultRef: ref,
      issues: [{ code: "NO_PROFILE_MATCH", path: [] }],
      issuesTruncated: false,
    };
    expect(
      witnessEvidenceSchema.safeParse({ ...witness, entries: [invalid] })
        .success,
    ).toBe(false);
    // Normalizable answers can have no matching profile without losing their hash.
    expect(
      witnessEvidenceSchema.safeParse({
        ...witness,
        status: "failed",
        entries: [invalid],
      }).success,
    ).toBe(true);
  });

  it("ties witness state and canonical hash presence to the actual failure class", () => {
    const mismatch = {
      ...selected,
      status: "mismatch",
      selectedResultRef: { ...ref, id: "result-b" },
      code: "WITNESS_RESULT_MISMATCH",
    };
    const invalid = (code: "INVALID_ANSWERS" | "NO_PROFILE_MATCH") => ({
      status: "invalid",
      expectedResultRef: ref,
      issues: [{ code, path: [] }],
      issuesTruncated: false,
    });
    const failed = { ...witness, status: "failed" };
    for (const value of [
      {
        ...witness,
        entries: [
          { ...selected, selectedResultRef: mismatch.selectedResultRef },
        ],
      },
      { ...failed, witnessesHash: null, entries: [mismatch] },
      {
        ...failed,
        witnessesHash: null,
        entries: [invalid("NO_PROFILE_MATCH")],
      },
      { ...failed, entries: [invalid("INVALID_ANSWERS")] },
      { ...failed, entries: [{ ...mismatch, selectedResultRef: ref }] },
    ])
      expect(witnessEvidenceSchema.safeParse(value).success).toBe(false);
    for (const value of [
      { ...failed, entries: [mismatch] },
      { ...failed, entries: [invalid("NO_PROFILE_MATCH")] },
      { ...failed, witnessesHash: null, entries: [invalid("INVALID_ANSWERS")] },
    ])
      expect(witnessEvidenceSchema.safeParse(value).success).toBe(true);
  });

  it("rejects policy substitution and mixed proof/failure fields", () => {
    expect(coverageEvidenceSchema.safeParse(coverage).success).toBe(true);
    for (const changed of [
      { ...coverage, policyHash: hash },
      { ...coverage, budget: { ...COVERAGE_POLICY, frontierStates: 20001 } },
      { ...coverage, limit: "transitions" },
      { ...coverage, stats: { ...coverage.stats, peakPathBytes: 4000001 } },
    ])
      expect(coverageEvidenceSchema.safeParse(changed).success).toBe(false);
  });

  it("cannot combine content and review-only source bindings", () => {
    const source = {
      commit: "b".repeat(40),
      path: "docs/FIRST_PRODUCT_CONTENT_DRAFT.md",
      sha256: hash,
    };
    expect(
      scoringSourceBindingSchema.safeParse({
        kind: "authoring-review",
        source,
        transcriptionSha256: hash,
      }).success,
    ).toBe(true);
    expect(
      scoringSourceBindingSchema.safeParse({
        kind: "content",
        contentSchemaVersion: "quizpack-content.v2",
        contentVersion: "1.0.0",
        canonicalContentSha256: hash,
        source,
        transcriptionSha256: hash,
      }).success,
    ).toBe(false);
  });

  it("requires coverage branch counts to describe complete, unique answers", () => {
    expect(
      coverageEvidenceSchema.safeParse({ ...coverage, processedQuestions: 5 })
        .success,
    ).toBe(false);
    const common = structuredClone(coverage);
    Reflect.deleteProperty(common, "proof");
    const answer = { questionId: "q1", optionId: "q1-a" };
    const uncovered = {
      ...common,
      status: "uncovered",
      processedQuestions: 1,
      counterexample: {
        normalizedAnswers: [answer],
        rawSums: [{ dimensionRef: dimension.dimensionRef, rawSum: -2 }],
      },
    };
    expect(coverageEvidenceSchema.safeParse(uncovered).success).toBe(true);
    expect(
      coverageEvidenceSchema.safeParse({ ...uncovered, processedQuestions: 2 })
        .success,
    ).toBe(false);
    expect(
      coverageEvidenceSchema.safeParse({
        ...uncovered,
        processedQuestions: 2,
        counterexample: {
          ...uncovered.counterexample,
          normalizedAnswers: [answer, answer],
        },
      }).success,
    ).toBe(false);
  });

  it("only permits fixed field names in public issue paths", () => {
    expect(
      scoringIssueSchema.safeParse({
        code: "INVALID_ANSWERS",
        path: ["answers", 1, "optionId"],
      }).success,
    ).toBe(true);
    expect(
      scoringIssueSchema.safeParse({
        code: "INVALID_ANSWERS",
        path: ["syntheticPrivateValue"],
      }).success,
    ).toBe(false);
  });
});
