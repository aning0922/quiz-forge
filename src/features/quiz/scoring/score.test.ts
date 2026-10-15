import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { canonicalOrdinaryJson } from "@/lib/json/canonical";
import {
  scoringIdentitySchema,
  scoreSnapshotSchema,
  type ScoringResult,
} from "@/lib/assessment-contract/scoring-api-v1";
import {
  prepareScoringDefinition,
  readScoringIdentity,
  scoreCompleteAnswers,
} from "./index";
import type { PreparedScoringDefinition } from "./contracts";
import { syntheticAnswers, syntheticDefinition } from "./fixtures/synthetic";
import { displayHalfUp } from "./rational";
function good<T>(r: ScoringResult<T>): T {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("TEST_EXPECTED_SUCCESS");
  return r.value;
}
describe("pure prepared exact scoring", () => {
  it("selects exact archetype ties by resultOrder, preserves negative bounds and freezes outputs", () => {
    const handle = good(prepareScoringDefinition(syntheticDefinition()));
    const identity = good(readScoringIdentity(handle));
    expect(scoringIdentitySchema.safeParse(identity).success).toBe(true);
    const score = good(scoreCompleteAnswers(handle, syntheticAnswers()));
    expect(scoreSnapshotSchema.safeParse(score).success).toBe(true);
    expect(score.dimensions.map((d) => [d.rawSum, d.normalized])).toEqual([
      [0, { numerator: "50", denominator: "1" }],
      [0, { numerator: "50", denominator: "1" }],
    ]);
    expect(score.decision.selectedResultRef.id).toBe("low");
    if (score.decision.kind !== "archetype")
      throw new Error("TEST_EXPECTED_ARCHETYPE");
    expect(score.decision.tiedMinimumResultRefs.map((r) => r.id)).toEqual([
      "low",
      "high",
    ]);
    expect(score.decision.distances.map((d) => d.value)).toEqual(
      Array(2).fill({ numerator: "5000", denominator: "1" }),
    );
    expect(Object.isFrozen(score.normalizedAnswers[0])).toBe(true);
    expect(Object.isFrozen(score.decision.distances[0]!.value)).toBe(true);
  });
  it("hashes the frozen normalized definition and domain LF exactly; profiles and vectors are maps", () => {
    const definition = syntheticDefinition();
    const original = good(
      readScoringIdentity(good(prepareScoringDefinition(definition))),
    );
    const expected = createHash("sha256")
      .update("quizforge:quiz-logic.v1\n")
      .update(
        canonicalOrdinaryJson(definition, { maxBytes: 2097152, maxDepth: 32 }),
      )
      .digest("hex");
    expect(original.logicHash).toBe(expected);
    definition.rules.profiles.reverse();
    definition.rules.normalization.bounds.reverse();
    for (const q of definition.questions)
      for (const o of q.options) o.contributions.reverse();
    definition.results.reverse();
    expect(
      good(readScoringIdentity(good(prepareScoringDefinition(definition))))
        .logicHash,
    ).toBe(original.logicHash);
    definition.questions.reverse();
    expect(
      good(readScoringIdentity(good(prepareScoringDefinition(definition))))
        .logicHash,
    ).not.toBe(original.logicHash);
  });
  it("does not retain input aliases and canonicalizes answer order", () => {
    const definition = syntheticDefinition(),
      answers = syntheticAnswers(2);
    const handle = good(prepareScoringDefinition(definition));
    const before = good(scoreCompleteAnswers(handle, answers));
    definition.questions[0]!.options[2]!.contributions[0]!.value = -100;
    expect(good(scoreCompleteAnswers(handle, [...answers].reverse()))).toEqual(
      before,
    );
    answers[0]!.optionId = "missing";
    expect(before.normalizedAnswers[0]!.optionId).toBe("q-0-o-2");
  });
  it("rejects forged, copied and JSON-roundtripped handles at every implemented execution entry", () => {
    const real = good(prepareScoringDefinition(syntheticDefinition()));
    for (const fake of [
      {},
      { ...real },
      JSON.parse(JSON.stringify(real)),
      new Proxy(real, {}),
    ]) {
      expect(
        readScoringIdentity(fake as PreparedScoringDefinition),
      ).toMatchObject({
        ok: false,
        issues: [{ code: "INVALID_PREPARED_DEFINITION" }],
      });
      expect(
        scoreCompleteAnswers(
          fake as PreparedScoringDefinition,
          syntheticAnswers(),
        ).ok,
      ).toBe(false);
    }
  });
  it.each([
    "proxy",
    "getter",
    "sparse",
    "cycle",
    "date",
    "symbol",
    "prototype",
  ])(
    "rejects %s before schema traversal without invoking accessors",
    (kind) => {
      let reads = 0;
      const d: unknown = syntheticDefinition();
      let input: unknown = d;
      if (kind === "proxy")
        input = new Proxy(d as object, {
          get() {
            reads++;
            throw new Error("MUST_NOT_READ");
          },
        });
      if (kind === "getter")
        Object.defineProperty(d, "secret", {
          enumerable: true,
          get() {
            reads++;
            throw new Error("MUST_NOT_READ");
          },
        });
      if (kind === "sparse") input = new Array(2);
      if (kind === "cycle") input = { self: null };
      if (kind === "cycle") (input as { self: unknown }).self = input;
      if (kind === "date") input = new Date();
      if (kind === "symbol")
        Object.defineProperty(d, Symbol("private"), { value: 1 });
      if (kind === "prototype") Object.setPrototypeOf(d, { inherited: true });
      expect(prepareScoringDefinition(input)).toMatchObject({
        ok: false,
        issues: [{ code: "INVALID_DEFINITION" }],
      });
      expect(reads).toBe(0);
    },
  );
  it.each([
    "foreign",
    "duplicate-option",
    "missing-vector",
    "duplicate-vector",
    "bounds",
    "constant",
    "engine",
    "result-order",
    "range",
  ])("rejects semantic %s failures", (kind) => {
    const d = syntheticDefinition(
      kind === "range" ? "dimensions" : "archetype",
    );
    if (kind === "foreign") d.questions[0]!.ref.version = "2.0.0";
    if (kind === "duplicate-option")
      d.questions[1]!.options[0]!.ref.id = d.questions[0]!.options[0]!.ref.id;
    if (kind === "missing-vector")
      d.questions[0]!.options[0]!.contributions.pop();
    if (kind === "duplicate-vector")
      d.questions[0]!.options[0]!.contributions[1] = structuredClone(
        d.questions[0]!.options[0]!.contributions[0]!,
      );
    if (kind === "bounds") d.rules.normalization.bounds[0]!.max = 3;
    if (kind === "constant")
      for (const q of d.questions)
        for (const o of q.options) o.contributions[0]!.value = 0;
    if (kind === "engine") d.engine.id = "dimensions";
    if (kind === "result-order") d.rules.resultOrder.pop();
    if (kind === "range" && d.rules.kind === "dimensions")
      d.rules.profiles[0]!.ranges[0]!.min = 100;
    expect(prepareScoringDefinition(d).ok).toBe(false);
  });
  it.each(
    [
      [],
      [syntheticAnswers()[0]],
      [syntheticAnswers()[0], syntheticAnswers()[0]],
      [{ questionId: "unknown", optionId: "q-0-o-1" }, syntheticAnswers()[1]],
      [{ questionId: "q-0", optionId: "q-1-o-1" }, syntheticAnswers()[1]],
      [{ ...syntheticAnswers()[0], score: 100 }, syntheticAnswers()[1]],
    ].map((answers) => ({ answers })),
  )("rejects malformed or incomplete answers %#", ({ answers }) => {
    const h = good(prepareScoringDefinition(syntheticDefinition()));
    expect(scoreCompleteAnswers(h, answers)).toMatchObject({
      ok: false,
      issues: [{ code: "INVALID_ANSWERS" }],
    });
  });
  it("dimensions includes closed endpoints, honors overlaps, and refuses unmatched complete answers", () => {
    const h = good(prepareScoringDefinition(syntheticDefinition("dimensions")));
    expect(
      good(scoreCompleteAnswers(h, syntheticAnswers(0))).decision
        .selectedResultRef.id,
    ).toBe("low");
    const overlap = good(scoreCompleteAnswers(h, syntheticAnswers()));
    expect(
      overlap.decision.kind === "dimensions" &&
        overlap.decision.matchingResultRefs.map((r) => r.id),
    ).toEqual(["low", "high"]);
    expect(
      good(scoreCompleteAnswers(h, syntheticAnswers(2))).decision
        .selectedResultRef.id,
    ).toBe("high");
    expect(scoreCompleteAnswers(h, syntheticAnswers(0, 2))).toMatchObject({
      ok: false,
      issues: [{ code: "NO_PROFILE_MATCH" }],
    });
  });
  it("reports unknown schema/engine and bounded input without leaking unknown keys", () => {
    const d = syntheticDefinition();
    expect(
      prepareScoringDefinition({ ...d, schemaVersion: "foundation.v1" }),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "UNSUPPORTED_LOGIC_SCHEMA" }],
    });
    expect(
      prepareScoringDefinition({
        ...d,
        engine: { id: "unknown", version: "1.0.0" },
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "UNSUPPORTED_ENGINE" }] });
    expect(
      prepareScoringDefinition({ ...d, privateData: "x".repeat(2097153) }),
    ).toMatchObject({ ok: false, issues: [{ code: "INPUT_LIMIT_EXCEEDED" }] });
    expect(
      JSON.stringify(prepareScoringDefinition({ ...d, privateSecret: true })),
    ).not.toContain("privateSecret");
  });
  it("formats half-up independently from exact matching", () => {
    expect(displayHalfUp(BigInt(5), BigInt(4))).toBe("1.3");
    expect(displayHalfUp(BigInt(0), BigInt(1))).toBe("0.0");
    expect(displayHalfUp(BigInt(100), BigInt(1))).toBe("100.0");
  });
});
