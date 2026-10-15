import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  prepareContentForScoring,
  scorePreparedContent,
  verifyPreparedContentWitnesses,
  analyzePreparedContentCoverage,
  contentWitnessEvidenceSchema,
  contentCoverageEvidenceSchema,
  type PreparedContent,
} from "./scoring-adapter";
import { createContentV2Fixture, asRef } from "./fixtures.test-support";
import { createSyntheticFixture } from "../v1/fixtures/synthetic";
import { canonicalP1Json } from "../v1/canonical";
import { scoringDefinitionSchema } from "@/lib/assessment-contract/scoring-api-v1";
import { coverageStress } from "@/features/quiz/scoring/fixtures/stress";
import type { SupportedContent } from "./supported";
const hash = (content: SupportedContent) =>
  createHash("sha256").update(canonicalP1Json(content)).digest("hex");
function prepare(content: unknown) {
  const result = prepareContentForScoring(content);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("TEST_PREPARE_FAILED");
  return result.value;
}
describe("actual content-bound witness and coverage evidence", () => {
  it.each(["dimensions", "archetype"] as const)(
    "executes all %s declarations and binds the complete v1/v2 source",
    async (engine) => {
      const v1 = (await createSyntheticFixture(engine)).content,
        v2 = await createContentV2Fixture(engine);
      const a = verifyPreparedContentWitnesses(prepare(v1)),
        b = verifyPreparedContentWitnesses(prepare(v2));
      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      if (!a.ok || !b.ok) return;
      expect(a.value.evidence).toEqual(b.value.evidence);
      expect(a.value.evidence.status).toBe("passed");
      expect(a.value.evidence.entries.map((entry) => entry.status)).toEqual([
        "passed",
        "passed",
        "passed",
      ]);
      expect(b.value.sourceBinding).toEqual({
        kind: "content",
        contentSchemaVersion: "quizpack-content.v2",
        contentVersion: v2.contentVersion,
        canonicalContentSha256: hash(v2),
      });
      expect(a.value.sourceBinding.canonicalContentSha256).not.toBe(
        b.value.sourceBinding.canonicalContentSha256,
      );
      expect(Object.isFrozen(b)).toBe(true);
      expect(Object.isFrozen(b.value.evidence.entries[0])).toBe(true);
      expect(Object.isFrozen(b.value.sourceBinding)).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(b))).toBeLessThanOrEqual(2097152);
    },
  );
  it("preserves original witness input order identity but normalizes execution and witnessesHash", async () => {
    const a = await createContentV2Fixture(),
      b = structuredClone(a);
    b.results.reverse();
    const first = verifyPreparedContentWitnesses(prepare(a)),
      second = verifyPreparedContentWitnesses(prepare(b));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.evidence.logicHash).toBe(
      second.value.evidence.logicHash,
    );
    expect(first.value.evidence.witnessesHash).toBe(
      second.value.evidence.witnessesHash,
    );
    expect(first.value.evidence.entries).toEqual(second.value.evidence.entries);
    expect(first.value.evidence.inputSha256).not.toBe(
      second.value.evidence.inputSha256,
    );
    expect(first.value.sourceBinding.canonicalContentSha256).not.toBe(
      second.value.sourceBinding.canonicalContentSha256,
    );
  });
  it("does not re-read caller witness mutations and records mismatches as failed evidence", async () => {
    const content = await createContentV2Fixture(),
      handle = prepare(content),
      before = verifyPreparedContentWitnesses(handle);
    for (const answer of content.results[0]!.witness.answers)
      answer.optionRef = asRef(
        content.questions.find((q) => q.id === answer.questionRef.id)!
          .options[2]!,
      );
    expect(verifyPreparedContentWitnesses(handle)).toEqual(before);
    const changed = verifyPreparedContentWitnesses(prepare(content));
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value.evidence.status).toBe("failed");
    expect(changed.value.evidence.entries[0]).toMatchObject({
      status: "mismatch",
      code: "WITNESS_RESULT_MISMATCH",
    });
    expect(changed.value.evidence.witnessesHash).not.toBeNull();
    expect(changed.value.sourceBinding.canonicalContentSha256).toBe(
      hash(content),
    );
  });
  it("keeps complete but unmatched witnesses canonical and returns uncovered coverage with a real counterexample", async () => {
    const content = await createContentV2Fixture("dimensions");
    if (content.rules.kind !== "dimensions")
      throw new Error("TEST_DIMENSIONS_REQUIRED");
    for (const profile of content.rules.profiles)
      for (const range of profile.ranges) {
        range.min = 0;
        range.max = 0;
      }
    const handle = prepare(content),
      witness = verifyPreparedContentWitnesses(handle),
      coverage = analyzePreparedContentCoverage(handle);
    expect(witness.ok).toBe(true);
    expect(coverage.ok).toBe(true);
    if (!witness.ok || !coverage.ok) return;
    expect(witness.value.evidence.status).toBe("failed");
    expect(witness.value.evidence.witnessesHash).not.toBeNull();
    expect(
      witness.value.evidence.entries.some(
        (e) =>
          e.status === "invalid" && e.issues[0]!.code === "NO_PROFILE_MATCH",
      ),
    ).toBe(true);
    expect(coverage.value.evidence.status).toBe("uncovered");
    if (coverage.value.evidence.status !== "uncovered") return;
    expect(
      scorePreparedContent(
        handle,
        coverage.value.evidence.counterexample.normalizedAnswers,
      ),
    ).toMatchObject({ ok: false, issues: [{ code: "NO_PROFILE_MATCH" }] });
    expect(coverage.value.sourceBinding).toEqual(witness.value.sourceBinding);
  });
  it("keeps coverage proof/policy/stats immutable and refuses archetype coverage without fake evidence", async () => {
    const content = await createContentV2Fixture("dimensions"),
      result = analyzePreparedContentCoverage(prepare(content));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evidence).toMatchObject({
      status: "proven",
      proof: { kind: "exhaustive-reachable-vectors", reachableVectorCount: 5 },
      processedQuestions: 2,
    });
    expect(result.value.sourceBinding.canonicalContentSha256).toBe(
      hash(content),
    );
    expect(Object.isFrozen(result.value.evidence.stats)).toBe(true);
    expect(Object.isFrozen(result.value.evidence.budget)).toBe(true);
    expect(contentCoverageEvidenceSchema.safeParse(result.value).success).toBe(
      true,
    );
    expect(
      analyzePreparedContentCoverage(prepare(await createContentV2Fixture())),
    ).toMatchObject({
      ok: false,
      issues: [{ code: "UNSUPPORTED_COVERAGE_ENGINE" }],
    });
  });
  it("does not allow authoring-review bindings or unissued handles to replace complete-content evidence", async () => {
    const content = await createContentV2Fixture("dimensions"),
      handle = prepare(content),
      witness = verifyPreparedContentWitnesses(handle),
      coverage = analyzePreparedContentCoverage(handle);
    expect(witness.ok).toBe(true);
    expect(coverage.ok).toBe(true);
    if (!witness.ok || !coverage.ok) return;
    const foreign = {
      kind: "authoring-review",
      source: {
        commit: "a".repeat(40),
        path: "docs/FIRST_PRODUCT_CONTENT_DRAFT.md",
        sha256: "b".repeat(64),
      },
      transcriptionSha256: "c".repeat(64),
    };
    expect(
      contentWitnessEvidenceSchema.safeParse({
        ...witness.value,
        sourceBinding: foreign,
      }).success,
    ).toBe(false);
    expect(
      contentCoverageEvidenceSchema.safeParse({
        ...coverage.value,
        sourceBinding: foreign,
      }).success,
    ).toBe(false);
    for (const forged of [
      {},
      { ...handle },
      JSON.parse(JSON.stringify(handle)),
      null,
    ]) {
      expect(
        verifyPreparedContentWitnesses(forged as PreparedContent),
      ).toMatchObject({
        ok: false,
        issues: [{ code: "INVALID_PREPARED_DEFINITION" }],
      });
      expect(
        analyzePreparedContentCoverage(forged as PreparedContent),
      ).toMatchObject({
        ok: false,
        issues: [{ code: "INVALID_PREPARED_DEFINITION" }],
      });
    }
  });
  it("preserves a real core frontier budget exit as inconclusive with source binding", async () => {
    const content = await createContentV2Fixture("dimensions");
    const definition = scoringDefinitionSchema.parse(
      JSON.parse(
        JSON.stringify(coverageStress("frontier")).replaceAll(
          '"scoring-budget"',
          JSON.stringify(content.product.productId),
        ),
      ),
    );
    content.dimensions = definition.dimensions.map((d) => ({
      ...d,
      label: "Synthetic dimension",
    }));
    content.questions = definition.questions.map((q) => ({
      ...q.ref,
      prompt: "Synthetic question",
      options: q.options.map((o) => ({
        ...o.ref,
        label: "Synthetic option",
        contributions: o.contributions,
      })),
    }));
    content.rules = definition.rules;
    content.results = content.results.slice(0, 2).map((r, i) => ({
      ...r,
      ...definition.results[i]!,
      witness: {
        status: "declared-not-executed",
        answers: content.questions.map((q) => ({
          questionRef: asRef(q),
          optionRef: asRef(q.options[0]!),
        })),
      },
    }));
    content.reportTemplates = content.reportTemplates.slice(0, 2);
    const portraits = content.results.map((r) => r.portraitRef),
      portraitIds = new Set(portraits.map((r) => r.id));
    content.resources = content.resources.filter(
      (r) => r.purpose !== "portrait" || portraitIds.has(r.id),
    );
    for (const state of ["result", "report", "poster"] as const)
      content.layouts[state].resourceRefs = portraits;
    content.visualPresentation.resourceDescriptions = content.resources.map(
      (r) => ({ resourceRef: asRef(r), alt: "Synthetic pixels" }),
    );
    content.visualPresentation.questionFrames = content.questions.map((q) => ({
      questionRef: asRef(q),
      sectionId: content.visualPresentation.sections[0]!.id,
      caption: "Synthetic caption",
    }));
    content.reportPresentation.resultCards =
      content.reportPresentation.resultCards
        .slice(0, 2)
        .map((card, i) => ({ ...card, resultRef: asRef(content.results[i]!) }));
    const result = analyzePreparedContentCoverage(prepare(content));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evidence).toMatchObject({
      status: "inconclusive",
      limit: "frontierStates",
    });
    expect(result.value.sourceBinding.canonicalContentSha256).toBe(
      hash(content),
    );
  });
});
