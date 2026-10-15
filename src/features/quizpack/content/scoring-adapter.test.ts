import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  prepareContentForScoring,
  scorePreparedContent,
  type PreparedContent,
} from "./scoring-adapter";
import { createContentV2Fixture } from "./fixtures.test-support";
import { createSyntheticFixture } from "../v1/fixtures/synthetic";
import { canonicalP1Json } from "../v1/canonical";
import type { SupportedContent } from "./supported";
const answers = (content: SupportedContent, index = 0) =>
  content.questions.map((question) => ({
    questionId: question.id,
    optionId: question.options[index]!.id,
  }));
function score(content: SupportedContent, input: unknown = answers(content)) {
  const p = prepareContentForScoring(content);
  expect(p.ok).toBe(true);
  if (!p.ok) throw new Error("PREPARE_FAILED");
  const result = scorePreparedContent(p.value, input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("SCORE_FAILED");
  return result.value;
}
describe("content scoring adapter calls the actual deterministic core", () => {
  it.each(["dimensions", "archetype"] as const)(
    "keeps v1/v2 %s arithmetic and hashes identical while binding distinct complete content",
    async (engine) => {
      const v1 = (await createSyntheticFixture(engine)).content,
        v2 = await createContentV2Fixture(engine);
      const a = score(v1),
        b = score(v2);
      expect(a.score).toEqual(b.score);
      expect(a.canonicalContentSha256).not.toBe(b.canonicalContentSha256);
      expect(b.canonicalContentSha256).toBe(
        createHash("sha256").update(canonicalP1Json(v2)).digest("hex"),
      );
      expect(b.reportTemplateRef).toEqual(v2.results[0]!.reportTemplateRef);
      expect(b.contentSchemaVersion).toBe("quizpack-content.v2");
    },
  );
  it("uses the selected result's exact report reference for every result", async () => {
    const c = await createContentV2Fixture();
    for (let index = 0; index < 3; index++) {
      const value = score(c, answers(c, index));
      expect(value.score.decision.selectedResultRef.id).toBe(
        c.results[index]!.id,
      );
      expect(value.reportTemplateRef).toEqual(
        c.results[index]!.reportTemplateRef,
      );
    }
  });
  it("freezes one source snapshot; caller mutation of rules, text, resources and report references has no effect", async () => {
    const c = await createContentV2Fixture(),
      sourceHash = createHash("sha256")
        .update(canonicalP1Json(c))
        .digest("hex"),
      p = prepareContentForScoring(c),
      input = answers(c);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    c.results[0]!.reportTemplateRef.id = "foreign";
    c.reportVersion = "9.0.0";
    c.rules.resultOrder.reverse();
    c.questions[0]!.prompt = "changed";
    c.resources[0]!.sha256 = "f".repeat(64);
    const result = scorePreparedContent(p.value, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reportTemplateRef.id).toBe("report-low");
    expect(result.value.reportVersion).toBe("1.0.0");
    expect(result.value.canonicalContentSha256).toBe(sourceHash);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.value.score.dimensions[0]!.normalized)).toBe(
      true,
    );
    expect(Object.isFrozen(result.value.reportTemplateRef)).toBe(true);
  });
  it("excludes all display semantics, kind and report binding from the logic hash", async () => {
    const original = await createContentV2Fixture(),
      changed = structuredClone(original);
    changed.kind = "authored";
    changed.visualPresentation.questionFrames[0]!.caption = "不同题签";
    changed.reportPresentation.resultCards[0]!.posterLine.text =
      "另一个原创短句。";
    changed.reportTemplates[0]!.baseline.summary = "另一份报告文案。";
    changed.reportVersion = "2.0.0";
    for (const report of changed.reportTemplates) report.version = "2.0.0";
    for (const result of changed.results)
      result.reportTemplateRef.version = "2.0.0";
    const a = score(original),
      b = score(changed);
    expect(a.score).toEqual(b.score);
    expect(a.canonicalContentSha256).not.toBe(b.canonicalContentSha256);
    expect(b.reportTemplateRef.version).toBe("2.0.0");
  });
  it("rejects forged/spread/serialized handles and refuses an externally supplied score as answers", async () => {
    const c = await createContentV2Fixture(),
      p = prepareContentForScoring(c);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    for (const handle of [
      {},
      { ...p.value },
      JSON.parse(JSON.stringify(p.value)),
      null,
    ])
      expect(
        scorePreparedContent(handle as PreparedContent, answers(c)),
      ).toMatchObject({
        ok: false,
        issues: [{ code: "INVALID_PREPARED_DEFINITION" }],
      });
    expect(scorePreparedContent(p.value, score(c).score)).toMatchObject({
      ok: false,
      issues: [{ code: "INVALID_ANSWERS" }],
    });
  });
  it("rejects structure, internal references, over-budget inputs and authoring-review as complete content", async () => {
    const c = await createContentV2Fixture(),
      cross = structuredClone(c);
    cross.results[0]!.reportTemplateRef.productId = "foreign";
    expect(prepareContentForScoring(cross)).toMatchObject({
      ok: false,
      issues: [{ code: "REFERENCE_MISMATCH" }],
    });
    expect(prepareContentForScoring({ ...c, extra: "x" })).toMatchObject({
      ok: false,
      issues: [{ code: "INVALID_DEFINITION" }],
    });
    expect(
      prepareContentForScoring({ ...c, extra: "x".repeat(2097152) }),
    ).toMatchObject({ ok: false, issues: [{ code: "INPUT_LIMIT_EXCEEDED" }] });
    expect(
      prepareContentForScoring({
        schemaVersion: "quiz-authoring-review.v1",
        status: "authored-pending",
        definition: {},
      }),
    ).toMatchObject({ ok: false, issues: [{ code: "INVALID_DEFINITION" }] });
  });
  it("does not access caller getters before the ordinary-JSON boundary", () => {
    const get = vi.fn();
    const input = {};
    Object.defineProperty(input, "schemaVersion", { get, enumerable: true });
    expect(prepareContentForScoring(input)).toMatchObject({
      ok: false,
      issues: [{ code: "INVALID_DEFINITION" }],
    });
    expect(get).not.toHaveBeenCalled();
  });
  it("does not attach a report when actual core execution has no matching profile or invalid answers", async () => {
    const c = await createContentV2Fixture("dimensions");
    if (c.rules.kind !== "dimensions")
      throw new Error("TEST_DIMENSIONS_REQUIRED");
    for (const profile of c.rules.profiles)
      for (const range of profile.ranges) {
        range.min = 0;
        range.max = 0;
      }
    const p = prepareContentForScoring(c);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    for (const input of [
      answers(c, 1),
      [],
      [
        {
          questionId: c.questions[0]!.id,
          optionId: c.questions[1]!.options[0]!.id,
        },
      ],
    ]) {
      const result = scorePreparedContent(p.value, input);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("reportTemplateRef");
    }
    expect(scorePreparedContent(p.value, answers(c, 1))).toMatchObject({
      ok: false,
      issues: [{ code: "NO_PROFILE_MATCH" }],
    });
  });
  it("prepares legal offline content larger than 1MiB without widening the raw ZIP input budget", async () => {
    const c = await createContentV2Fixture(),
      text = "文".repeat(4000);
    for (const report of c.reportTemplates)
      report.baseline = {
        title: text,
        summary: text,
        strengths: Array(8).fill(text),
        tensions: Array(8).fill(text),
        reflection: text,
        disclaimer: text,
      };
    for (const layout of Object.values(c.layouts)) {
      layout.props.heading = text;
      layout.props.body = text;
    }
    for (const resource of c.resources) {
      resource.source.attribution = text;
      resource.source.evidence = text;
      resource.license.evidence = text;
    }
    for (const question of c.questions) {
      question.prompt = text;
      for (const option of question.options) option.label = text;
    }
    for (const result of c.results) result.label = text;
    for (const dimension of c.dimensions) dimension.label = text;
    c.product.title = text;
    const bytes = Buffer.byteLength(canonicalP1Json(c));
    expect(bytes).toBeGreaterThan(1048576);
    expect(bytes).toBeLessThanOrEqual(2097152);
    const result = score(c);
    expect(result.contentSchemaVersion).toBe("quizpack-content.v2");
    expect(
      Buffer.byteLength(JSON.stringify({ ok: true, value: result })),
    ).toBeLessThanOrEqual(65536);
  });
});
