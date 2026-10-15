import { beforeAll, describe, expect, it, vi } from "vitest";
import { createSyntheticFixture } from "@/features/quizpack/v1/fixtures/synthetic";
import {
  prepareContentForScoring,
  scorePreparedContent,
} from "@/features/quizpack/content/scoring-adapter";
import { asRef } from "@/features/quizpack/content/fixtures.test-support";
import type { QuizPackContentV2 } from "@/features/quizpack/content/v2";
import type { PreparedPreview } from "@/features/product/preview/projection-contract";
import {
  previewEntryResponseSchema,
  previewRevealResponseSchema,
} from "@/features/product/preview/contracts";
import { preparePreviewContent, scorePreview } from "./projection";
import {
  previewFixture,
  sourceBinding,
  answers,
  requestId,
  expandDimensions,
  expandQuestions,
} from "./fixtures.test-support";

let fixture: QuizPackContentV2;
beforeAll(async () => {
  fixture = await previewFixture();
});
const prepare = (
  content = structuredClone(fixture),
  binding = sourceBinding(content),
) => preparePreviewContent(content, binding);
function reveal(content = structuredClone(fixture), option = 0) {
  const prepared = prepare(content);
  if (!prepared.ok) throw new Error(prepared.code);
  return scorePreview(
    prepared.value.prepared,
    answers(content, option),
    requestId,
  );
}

describe("server-only fixed revision projection", () => {
  it.each(["dimensions", "archetype"] as const)(
    "uses the real %s engine for every selected card and complete baseline",
    async (engine) => {
      const content = await previewFixture(engine),
        prepared = prepare(content),
        core = prepareContentForScoring(content);
      expect(prepared.ok).toBe(true);
      if (!prepared.ok || !core.ok) throw new Error("fixture");
      for (let i = 0; i < content.results.length; i++) {
        const input = answers(content, i),
          actual = scorePreparedContent(core.value, input),
          result = scorePreview(prepared.value.prepared, input, requestId);
        expect(result.ok).toBe(true);
        if (!result.ok || !actual.ok) throw new Error("fixture");
        const selected = actual.value.score.decision.selectedResultRef;
        const card = content.reportPresentation.resultCards.find(
          (c) => c.resultRef.id === selected.id,
        )!;
        const baseline = content.reportTemplates.find(
          (r) => r.id === actual.value.reportTemplateRef.id,
        )!.baseline;
        expect(result.value).toMatchObject({
          binding: sourceBinding(content),
          requestId,
          answersHash: actual.value.score.answersHash,
          logicHash: actual.value.score.logicHash,
          selectedResultRef: selected,
          reportTemplateRef: actual.value.reportTemplateRef,
          result: { displayName: card.displayName, subtitle: card.subtitle },
          report: { mode: "DETERMINISTIC", baseline },
          poster: { kind: "ready", displayName: card.displayName },
        });
        expect(result.value.dimensions.map((d) => d.normalizedText)).toEqual(
          Array(content.dimensions.length).fill(`${i * 50}.0`),
        );
        expect(previewRevealResponseSchema.safeParse(result).success).toBe(
          true,
        );
        expect(JSON.stringify(result)).not.toMatch(
          /normalizedAnswers|rawSum|matchingResultRefs|distances|tiedMinimumResultRefs|contributions|witnesses|targets/,
        );
      }
    },
  );
  it("preserves authored metadata without granting approval or changing the selected logic", () => {
    const synthetic = structuredClone(fixture),
      authored = structuredClone(fixture);
    authored.kind = "authored";
    const entry = prepare(authored),
      a = reveal(synthetic),
      b = reveal(authored);
    if (!entry.ok || !a.ok || !b.ok) throw new Error("fixture");
    expect(entry.value.entry.kind).toBe("authored");
    expect(
      entry.value.entry.assets.every((asset) => asset.approval === "pending"),
    ).toBe(true);
    expect(b.value.logicHash).toBe(a.value.logicHash);
    expect(b.value.selectedResultRef).toEqual(a.value.selectedResultRef);
    expect(b.value.binding.canonicalContentSha256).not.toBe(
      a.value.binding.canonicalContentSha256,
    );
  });
  it("formats a true fractional normalized score with the existing exact half-up policy", () => {
    const content = structuredClone(fixture);
    expandQuestions(content, 3);
    const p = prepare(content);
    if (!p.ok) throw new Error("fixture");
    const input = answers(content);
    input[2]!.optionId = content.questions[2]!.options[1]!.id;
    const result = scorePreview(p.value.prepared, input, requestId);
    if (!result.ok) throw new Error("fixture");
    expect(result.value.dimensions.map((d) => d.normalizedText)).toEqual([
      "16.7",
      "16.7",
    ]);
  });
  it("projects all and only neutral resources with exact section/frame/override refs", () => {
    const content = structuredClone(fixture),
      cover = content.resources[0]!,
      scene = content.resources.at(-1)!;
    const override = {
      ...scene,
      id: "override-scene",
      path: "assets/override-scene.png",
    };
    content.resources.push(override);
    content.visualPresentation.resourceDescriptions.push({
      resourceRef: asRef(override),
      alt: "独立中性场景",
    });
    content.visualPresentation.questionFrames[1]!.sceneOverrideRef =
      asRef(override);
    content.layouts.question.resourceRefs.push(asRef(override));
    content.layouts.resume.resourceRefs.push(asRef(override));
    const result = prepare(content);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("fixture");
    expect(result.value.entry.assets.map((a) => a.resourceRef)).toEqual([
      asRef(cover),
      asRef(scene),
      asRef(override),
    ]);
    expect(result.value.entry.visualPresentation).toEqual({
      coverSceneRef: content.visualPresentation.coverSceneRef,
      sections: content.visualPresentation.sections,
      questionFrames: content.visualPresentation.questionFrames,
    });
    expect(
      previewEntryResponseSchema.safeParse({
        ok: true,
        value: result.value.entry,
      }).success,
    ).toBe(true);
    expect(Object.keys(result.value.entry.layouts)).toEqual([
      "cover",
      "question",
      "resume",
    ]);
    expect(JSON.stringify(result.value.entry)).not.toMatch(
      /portrait|contributions|rules|results|resultCards|baseline|witness|reportTemplates|resourceRefs|storageKey|assets\//,
    );
    expect(JSON.stringify(result.value.entry)).not.toContain("license");
  });
  it("keeps opaque handles and returned DTOs independent from mutable source/binding aliases", () => {
    const content = structuredClone(fixture),
      binding = sourceBinding(content),
      original = structuredClone(content),
      result = prepare(content, binding);
    if (!result.ok) throw new Error("fixture");
    const entryText = JSON.stringify(result.value.entry);
    content.product.title = "changed";
    content.results[0]!.reportTemplateRef.version = "9.0.0";
    content.resources[0]!.sha256 = "f".repeat(64);
    content.questions[0]!.options[0]!.contributions[0]!.value = 99;
    binding.font.fileSha256 = "f".repeat(64);
    expect(JSON.stringify(result.value.entry)).toBe(entryText);
    expect(Object.isFrozen(result.value.entry.questions[0]!.options)).toBe(
      true,
    );
    expect(() => JSON.stringify(result.value.prepared)).toThrow(
      "PREVIEW_PRIVATE_HANDLE",
    );
    expect(result.value.prepared).not.toBeInstanceOf(Map);
    expect(Object.keys(result.value.prepared)).toEqual([]);
    for (const fake of [
      {},
      JSON.parse("{}"),
      new Map(),
      new Proxy(result.value.prepared, {}),
    ])
      expect(
        scorePreview(fake as PreparedPreview, answers(original), requestId),
      ).toEqual({ ok: false, code: "PREVIEW_BINDING_MISMATCH" });
    const scored = scorePreview(
      result.value.prepared,
      answers(original),
      requestId,
    );
    expect(scored.ok).toBe(true);
    if (!scored.ok) throw new Error("fixture");
    expect(scored.value.binding.font.fileSha256).not.toBe("f".repeat(64));
    expect(() => {
      result.value.entry.product.title = "tampered";
    }).toThrow();
    expect(
      scorePreview(result.value.prepared, answers(original), requestId),
    ).toEqual(scored);
  });
  it.each([
    "content",
    "assets",
    "product",
    "renderer",
    "font",
    "coverage",
  ] as const)("rejects mismatched %s binding", (field) => {
    const content = structuredClone(fixture),
      binding = sourceBinding(content);
    if (field === "content") binding.canonicalContentSha256 = "f".repeat(64);
    if (field === "assets") binding.assetSetSha256 = "f".repeat(64);
    if (field === "product") binding.productId = "another-product";
    if (field === "renderer") binding.renderer.version = "1.0.1";
    if (field === "font") binding.font.fileSha256 = "f".repeat(64);
    if (field === "coverage") binding.font.coverageSha256 = "f".repeat(64);
    expect(prepare(content, binding)).toEqual({
      ok: false,
      code: "PREVIEW_BINDING_MISMATCH",
    });
  });
  it("includes declaration/approval and full entity identities in snapshot binding", () => {
    for (const edit of [
      (c: QuizPackContentV2) => {
        c.resources[0]!.approval = "approved";
      },
      (c: QuizPackContentV2) => {
        c.resources[0]!.source.evidence = "Changed declaration";
      },
      (c: QuizPackContentV2) => {
        c.visualPresentation.resourceDescriptions[0]!.alt = "Changed alt";
      },
    ]) {
      const content = structuredClone(fixture),
        binding = sourceBinding(content);
      edit(content);
      binding.canonicalContentSha256 =
        sourceBinding(content).canonicalContentSha256;
      const changed = prepare(content, binding);
      if (
        content.visualPresentation.resourceDescriptions[0]!.alt ===
        "Changed alt"
      )
        expect(changed.ok).toBe(true);
      else
        expect(changed).toEqual({
          ok: false,
          code: "PREVIEW_BINDING_MISMATCH",
        });
    }
  });
  it.each([
    "frame-order",
    "scene-owner",
    "report-version",
    "portrait-version",
    "neutral-portrait",
    "layout-resources",
  ] as const)("rejects %s instead of repairing refs", (kind) => {
    const c = structuredClone(fixture);
    if (kind === "frame-order") c.visualPresentation.questionFrames.reverse();
    if (kind === "scene-owner")
      c.visualPresentation.sections[0]!.sceneRef.productId = "foreign";
    if (kind === "report-version")
      c.results[0]!.reportTemplateRef.version = "9.0.0";
    if (kind === "portrait-version")
      c.results[0]!.portraitRef.version = "9.0.0";
    if (kind === "neutral-portrait")
      c.visualPresentation.coverSceneRef = c.results[0]!.portraitRef;
    if (kind === "layout-resources")
      c.layouts.question.resourceRefs = [c.results[0]!.portraitRef];
    expect(prepare(c).ok).toBe(false);
  });
  it.each([
    "component",
    "version",
    "props-version",
    "extra-props",
    "engine",
  ] as const)("rejects unknown registry %s", (kind) => {
    const c = structuredClone(fixture);
    if (kind === "component")
      Object.assign(c.layouts.cover.component, { id: "folio-question" });
    if (kind === "version")
      Object.assign(c.layouts.cover.component, { version: "9.0.0" });
    if (kind === "props-version")
      Object.assign(c.layouts.cover.component, { propsSchemaVersion: "9.0.0" });
    if (kind === "extra-props")
      Object.assign(c.layouts.cover.props, { html: "arbitrary" });
    if (kind === "engine") Object.assign(c.engine, { version: "9.0.0" });
    expect(prepare(c)).toEqual({ ok: false, code: "PREVIEW_UNSUPPORTED" });
  });
  it("rejects v1/review-envelope/accessors/proxies/nonordinary values without invoking getters", async () => {
    const v1 = await createSyntheticFixture();
    expect(preparePreviewContent(v1.content, sourceBinding(fixture))).toEqual({
      ok: false,
      code: "PREVIEW_UNSUPPORTED",
    });
    expect(
      preparePreviewContent(
        { status: "authored-pending", definition: {} },
        sourceBinding(fixture),
      ).ok,
    ).toBe(false);
    const getter = vi.fn();
    const input = {
      ...fixture,
      get product() {
        getter();
        return fixture.product;
      },
    };
    for (const content of [input, new Proxy(fixture, {}), new Date()])
      expect(preparePreviewContent(content, sourceBinding(fixture)).ok).toBe(
        false,
      );
    const bad = Object.defineProperty(sourceBinding(fixture), "productId", {
      get: getter,
    });
    expect(preparePreviewContent(fixture, bad).ok).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    const invalid = structuredClone(fixture);
    invalid.product.title = "bad\ud800";
    expect(prepare(invalid).ok).toBe(false);
  });
  it("rejects incomplete/duplicate/foreign/extra-field answers and oversized input with finite failures", () => {
    const content = structuredClone(fixture),
      p = prepare(content);
    if (!p.ok) throw new Error("fixture");
    for (const input of [
      [],
      answers(content).slice(1),
      [answers(content)[0], answers(content)[0]],
      [{ questionId: "foreign", optionId: "foreign" }, answers(content)[1]],
      [{ ...answers(content)[0], score: 100 }, answers(content)[1]],
    ])
      expect(scorePreview(p.value.prepared, input, requestId)).toEqual({
        ok: false,
        code: "PREVIEW_INVALID_ANSWERS",
      });
    expect(
      scorePreview(p.value.prepared, "x".repeat(65537), requestId),
    ).toEqual({ ok: false, code: "PREVIEW_LIMIT_EXCEEDED" });
    expect(
      scorePreview(p.value.prepared, answers(content), "not-uuid"),
    ).toEqual({ ok: false, code: "PREVIEW_INVALID_ANSWERS" });
    const getter = vi.fn();
    expect(
      scorePreview(
        p.value.prepared,
        [
          {
            get questionId() {
              getter();
              return "first";
            },
            optionId: "first-option-0",
          },
        ],
        requestId,
      ).ok,
    ).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
  it.each([1, 4, 5, 16])(
    "preserves all %i dimensions and never selects a top-four subset",
    (count) => {
      const content = structuredClone(fixture);
      expandDimensions(content, count);
      const result = reveal(content);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("fixture");
      expect(result.value.dimensions).toHaveLength(count);
      expect(result.value.poster.kind).toBe(
        count <= 4 ? "ready" : "unavailable",
      );
      if (result.value.poster.kind === "ready")
        expect(result.value.poster.dimensions).toEqual(result.value.dimensions);
    },
  );
  it.each([
    "name",
    "subtitle",
    "line",
    "disclosure",
    "dimension",
    "name-lines",
    "line-lines",
    "disclosure-lines",
  ] as const)("makes only poster unavailable on %s overflow", (field) => {
    const c = structuredClone(fixture),
      card = c.reportPresentation.resultCards[0]!;
    if (field === "name") card.displayName = "名".repeat(13);
    if (field === "subtitle") card.subtitle = "题".repeat(25);
    if (field === "line") card.posterLine.text = "句".repeat(49);
    if (field === "disclosure") card.posterDisclosure = "明".repeat(73);
    if (field === "dimension") c.dimensions[0]!.label = "维".repeat(9);
    if (field === "name-lines") card.displayName = "甲\n乙";
    if (field === "line-lines") card.posterLine.text = "甲\r\n乙\n丙";
    if (field === "disclosure-lines") card.posterDisclosure = "甲\n乙\n丙";
    const result = reveal(c);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("fixture");
    expect(result.value.poster).toEqual({
      kind: "unavailable",
      code: "POSTER_LIMIT_EXCEEDED",
    });
    expect(result.value.report.baseline).toEqual(
      c.reportTemplates[0]!.baseline,
    );
  });
  it("accepts poster codepoint boundaries without erasing original text", () => {
    const c = structuredClone(fixture),
      card = c.reportPresentation.resultCards[0]!;
    card.displayName = "人".repeat(12);
    card.subtitle = "题".repeat(24);
    card.posterLine.text = "句".repeat(48);
    card.posterDisclosure = "明".repeat(72);
    c.dimensions[0]!.label = "维".repeat(8);
    const result = reveal(c);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.poster.kind !== "ready")
      throw new Error("fixture");
    expect(result.value.poster.posterLine).toEqual(card.posterLine);
    expect(result.value.poster.posterDisclosure).toBe(card.posterDisclosure);
  });
  it("binds revision and request identities without changing actual logic or answer hash", () => {
    const c = structuredClone(fixture),
      b = sourceBinding(c),
      one = prepare(c, b);
    b.revision = 2;
    const two = prepare(c, b);
    if (!one.ok || !two.ok) throw new Error("fixture");
    const first = scorePreview(one.value.prepared, answers(c), requestId),
      second = scorePreview(
        two.value.prepared,
        answers(c),
        "33333333-3333-4333-8333-333333333333",
      );
    if (!first.ok || !second.ok) throw new Error("fixture");
    expect(first.value.binding.revision).toBe(1);
    expect(second.value.binding.revision).toBe(2);
    expect(first.value.requestId).not.toBe(second.value.requestId);
    expect(first.value.answersHash).toBe(second.value.answersHash);
    expect(first.value.logicHash).toBe(second.value.logicHash);
  });
});
