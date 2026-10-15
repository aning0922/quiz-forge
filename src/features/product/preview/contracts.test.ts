import { beforeAll, describe, expect, it } from "vitest";
import { createContentV2Fixture } from "@/features/quizpack/content/fixtures.test-support";
import type { QuizPackContentV2 } from "@/features/quizpack/content/v2";
import { PREVIEW_FONT, PREVIEW_RENDERER } from "./descriptor";
import { PREVIEW_LIMITS } from "./limits";
import {
  previewBindingSchema,
  previewEntryResponseSchema,
  previewRevealResponseSchema,
  bindingUsesCurrentRenderer,
  samePreviewBinding,
  previewEntrySchema,
  previewRevealSchema,
  previewScoreRequestSchema,
  previewDimensionSchema,
  type PreviewEntry,
  type PreviewReveal,
  type PreviewBinding,
} from "./contracts";
import { previewResourceUrl, parsePreviewResourceQuery } from "./urls";
let entry: PreviewEntry, reveal: PreviewReveal, binding: PreviewBinding;
const ref = (v: { id: string; productId: string; version: string }) => ({
  id: v.id,
  productId: v.productId,
  version: v.version,
});
beforeAll(async () => {
  const c: QuizPackContentV2 = await createContentV2Fixture("archetype");
  binding = previewBindingSchema.parse({
    productId: c.product.productId,
    draftId: "11111111-1111-4111-8111-111111111111",
    revision: 1,
    canonicalContentSha256: "a".repeat(64),
    assetSetSha256: "b".repeat(64),
    renderer: PREVIEW_RENDERER,
    font: PREVIEW_FONT,
  });
  const layout = (s: keyof typeof c.layouts) => ({
    component: c.layouts[s].component,
    props: c.layouts[s].props,
  });
  const asset = (r: (typeof c.resources)[number]) => ({
    resourceRef: ref(r),
    mediaType: r.mediaType,
    bytes: r.bytes,
    sha256: r.sha256,
    width: r.width,
    height: r.height,
    purpose: r.purpose,
    approval: r.approval,
    alt: c.visualPresentation.resourceDescriptions.find(
      (d) => d.resourceRef.id === r.id,
    )!.alt,
  });
  const refs = new Set([
    c.visualPresentation.coverSceneRef.id,
    ...c.visualPresentation.sections.map((s) => s.sceneRef.id),
    ...c.visualPresentation.questionFrames.flatMap((f) =>
      f.sceneOverrideRef ? [f.sceneOverrideRef.id] : [],
    ),
  ]);
  entry = previewEntrySchema.parse({
    binding,
    contentSchemaVersion: c.schemaVersion,
    kind: c.kind,
    engine: c.engine,
    product: { productId: c.product.productId, title: c.product.title },
    layouts: {
      cover: layout("cover"),
      question: layout("question"),
      resume: layout("resume"),
    },
    questions: c.questions.map((q) => ({
      ...ref(q),
      prompt: q.prompt,
      options: q.options.map((o) => ({ ...ref(o), label: o.label })),
    })),
    visualPresentation: {
      coverSceneRef: c.visualPresentation.coverSceneRef,
      sections: c.visualPresentation.sections,
      questionFrames: c.visualPresentation.questionFrames,
    },
    assets: c.resources.filter((r) => refs.has(r.id)).map(asset),
  });
  const result = c.results[0]!;
  const portrait = asset(
    c.resources.find((r) => r.id === result.portraitRef.id)!,
  );
  const dimensions = c.dimensions.map((d) => ({
    dimensionRef: ref(d),
    label: "维度",
    normalizedText: "50.0",
  }));
  // Shape-only synthetic evidence; actual score selection is tested by the projection owner.
  reveal = previewRevealSchema.parse({
    binding,
    requestId: "22222222-2222-4222-8222-222222222222",
    answersHash: "c".repeat(64),
    logicHash: "d".repeat(64),
    contentSchemaVersion: c.schemaVersion,
    contentVersion: c.contentVersion,
    reportVersion: c.reportVersion,
    selectedResultRef: ref(result),
    reportTemplateRef: result.reportTemplateRef,
    dimensions,
    result: {
      layout: layout("result"),
      displayName: "合成样本",
      subtitle: "结构夹具",
      portrait,
    },
    report: {
      layout: layout("report"),
      mode: "DETERMINISTIC",
      baseline: c.reportTemplates.find(
        (r) => r.id === result.reportTemplateRef.id,
      )!.baseline,
    },
    poster: {
      kind: "ready",
      layout: layout("poster"),
      displayName: "合成样本",
      subtitle: "结构夹具",
      posterLine: { kind: "original", text: "合成文字" },
      posterDisclosure: "仅供测试",
      portrait,
      dimensions,
    },
  });
});
describe("fixed preview contract boundaries", () => {
  it("accepts the finite DTOs without exposing the full content", () => {
    expect(previewEntrySchema.safeParse(entry).success).toBe(true);
    expect(previewRevealSchema.safeParse(reveal).success).toBe(true);
    expect(bindingUsesCurrentRenderer(binding)).toBe(true);
    expect(samePreviewBinding(binding, structuredClone(binding))).toBe(true);
  });
  it.each(["rules", "results", "witnesses", "reportTemplates"])(
    "rejects pre-reveal %s instead of silently stripping it",
    (field) => {
      expect(
        previewEntrySchema.safeParse({ ...entry, [field]: [] }).success,
      ).toBe(false);
    },
  );
  it("rejects contribution and layout resource leakage", () => {
    const x = structuredClone(entry) as unknown as Record<string, unknown>;
    const bad = structuredClone(entry);
    Object.assign(bad.questions[0]!.options[0]!, { contributions: [] });
    expect(previewEntrySchema.safeParse(bad).success).toBe(false);
    Object.assign((x.layouts as PreviewEntry["layouts"]).cover, {
      resourceRefs: [],
    });
    expect(previewEntrySchema.safeParse(x).success).toBe(false);
  });
  it("rejects wrong-product, missing frames, duplicate assets and unrequested assets", () => {
    const variants = [
      structuredClone(entry),
      structuredClone(entry),
      structuredClone(entry),
      structuredClone(entry),
    ];
    variants[0]!.questions[0]!.productId = "another-product";
    variants[1]!.visualPresentation.questionFrames.pop();
    variants[2]!.assets.push(variants[2]!.assets[0]!);
    variants[3]!.assets[0]!.resourceRef.id = "unrequested-asset";
    for (const value of variants)
      expect(previewEntrySchema.safeParse(value).success).toBe(false);
  });
  it("rejects a portrait in the neutral asset list and a component from another state", () => {
    const x = structuredClone(entry);
    Object.assign(x.assets[0]!, { purpose: "portrait" });
    expect(previewEntrySchema.safeParse(x).success).toBe(false);
    const y = structuredClone(entry);
    Object.assign(y.layouts.cover.component, { id: "folio-question" });
    expect(previewEntrySchema.safeParse(y).success).toBe(false);
  });
  it("distinguishes content, asset, renderer and font bindings", () => {
    for (const modify of [
      (v: PreviewBinding) => {
        v.revision = 2;
      },
      (v: PreviewBinding) => {
        v.assetSetSha256 = "f".repeat(64);
      },
      (v: PreviewBinding) => {
        v.canonicalContentSha256 = "f".repeat(64);
      },
      (v: PreviewBinding) => {
        v.font.fileSha256 = "f".repeat(64);
      },
      (v: PreviewBinding) => {
        v.renderer.version = "1.0.1";
      },
    ]) {
      const changed = structuredClone(binding);
      modify(changed);
      expect(samePreviewBinding(binding, changed)).toBe(false);
    }
    const old = structuredClone(binding);
    old.font.version = "0.9.0";
    expect(bindingUsesCurrentRenderer(old)).toBe(false);
  });
  it.each(["100.1", "-0.1", "00.0", "1.00", "1e1", "50.0\n"])(
    "rejects noncanonical display %j",
    (normalizedText) => {
      expect(
        previewDimensionSchema.safeParse({
          ...reveal.dimensions[0],
          normalizedText,
        }).success,
      ).toBe(false);
    },
  );
  it("rejects a selected poster from different answers, dimensions or portrait", () => {
    const x = structuredClone(reveal),
      y = structuredClone(reveal);
    if (x.poster.kind === "ready")
      x.poster.dimensions[0]!.normalizedText = "99.9";
    if (y.poster.kind === "ready") y.poster.portrait.sha256 = "f".repeat(64);
    expect(previewRevealSchema.safeParse(x).success).toBe(false);
    expect(previewRevealSchema.safeParse(y).success).toBe(false);
  });
  it("rejects oversized ready poster while preserving an explicit unavailable report", () => {
    const x = structuredClone(reveal);
    if (x.poster.kind === "ready") x.poster.posterLine.text = "字".repeat(49);
    expect(previewRevealSchema.safeParse(x).success).toBe(false);
    x.poster = { kind: "unavailable", code: "POSTER_LIMIT_EXCEEDED" };
    expect(previewRevealSchema.safeParse(x).success).toBe(true);
  });
  it("refuses client-supplied conclusions in the score request", () => {
    const request = {
      binding,
      requestId: reveal.requestId,
      answers: [
        {
          questionId: entry.questions[0]!.id,
          optionId: entry.questions[0]!.options[0]!.id,
        },
      ],
    };
    expect(previewScoreRequestSchema.safeParse(request).success).toBe(true);
    expect(
      previewScoreRequestSchema.safeParse({
        ...request,
        selectedResultRef: reveal.selectedResultRef,
      }).success,
    ).toBe(false);
  });
  it("round-trips only the exact resource request and rejects ambiguous or oversized query", () => {
    const request = { binding, resourceRef: entry.assets[0]!.resourceRef };
    const url = new URL(previewResourceUrl(request), "http://127.0.0.1:3100");
    expect(parsePreviewResourceQuery(url)).toEqual(request);
    url.searchParams.append("q", "{}");
    expect(() => parsePreviewResourceQuery(url)).toThrow(
      "INVALID_PREVIEW_RESOURCE_QUERY",
    );
    url.search =
      "?q=" +
      encodeURIComponent(JSON.stringify({ ...request, path: "/private" }));
    expect(() => parsePreviewResourceQuery(url)).toThrow();
    url.search = "?q=" + "a".repeat(4096);
    expect(() => parsePreviewResourceQuery(url)).toThrow();
  });
});

function envelopeBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify({ ok: true, value }))
    .byteLength;
}
it("bounds the complete valid entry at exactly 512 KiB including escaped Unicode", () => {
  const x = structuredClone(entry),
    q = x.questions[0]!,
    frame = x.visualPresentation.questionFrames[0]!;
  x.questions = Array.from({ length: 100 }, (_, i) => ({
    ...structuredClone(q),
    id: `question-${i}`,
    prompt: "字\t",
    options: q.options.map((o, j) => ({
      ...o,
      id: `option-${i}-${j}`,
      label: "字\t",
    })),
  }));
  x.visualPresentation.questionFrames = x.questions.map((q) => ({
    ...frame,
    questionRef: ref(q),
  }));
  const slots = x.questions.flatMap((q) => [
    {
      get: () => q.prompt,
      set: (s: string) => {
        q.prompt = s;
      },
    },
    ...q.options.map((o) => ({
      get: () => o.label,
      set: (s: string) => {
        o.label = s;
      },
    })),
  ]);
  let remaining = PREVIEW_LIMITS.entryResponseBytes - envelopeBytes(x);
  let spare: (typeof slots)[number] | undefined;
  for (const slot of slots) {
    const n = Math.min(remaining, 4000 - slot.get().length);
    slot.set(slot.get() + "a".repeat(n));
    remaining -= n;
    if (remaining === 0) {
      spare = slot;
      break;
    }
  }
  expect(remaining).toBe(0);
  expect(envelopeBytes(x)).toBe(PREVIEW_LIMITS.entryResponseBytes);
  expect(
    previewEntryResponseSchema.safeParse({ ok: true, value: x }).success,
  ).toBe(true);
  spare!.set(spare!.get() + "a");
  expect(previewEntrySchema.safeParse(x).success).toBe(true);
  expect(
    previewEntryResponseSchema.safeParse({ ok: true, value: x }).success,
  ).toBe(false);
});
it("bounds the complete reveal at 256 KiB without truncating a valid long report", () => {
  const x = structuredClone(reveal);
  x.poster = { kind: "unavailable", code: "POSTER_LIMIT_EXCEEDED" };
  x.report.baseline.strengths = Array(8).fill("a");
  x.report.baseline.tensions = Array(8).fill("a");
  const slots: Array<{ get: () => string; set: (s: string) => void }> = [];
  for (const key of ["title", "summary", "reflection", "disclaimer"] as const) {
    x.report.baseline[key] = "a";
    slots.push({
      get: () => x.report.baseline[key],
      set: (s) => {
        x.report.baseline[key] = s;
      },
    });
  }
  for (const key of ["strengths", "tensions"] as const)
    for (let i = 0; i < 8; i++)
      slots.push({
        get: () => x.report.baseline[key][i]!,
        set: (s) => {
          x.report.baseline[key][i] = s;
        },
      });
  for (const part of [x.result.layout.props, x.report.layout.props])
    for (const key of ["heading", "body"] as const) {
      part[key] = "a";
      slots.push({
        get: () => part[key],
        set: (s) => {
          part[key] = s;
        },
      });
    }
  let remaining = PREVIEW_LIMITS.revealResponseBytes - envelopeBytes(x);
  let spare: (typeof slots)[number] | undefined;
  for (const slot of slots) {
    const n = Math.min(remaining, 11996),
      bytes = n + 1;
    slot.set("字".repeat(Math.floor(bytes / 3)) + "a".repeat(bytes % 3));
    remaining -= n;
    if (remaining === 0) {
      spare = slot;
      break;
    }
  }
  expect(remaining).toBe(0);
  expect(envelopeBytes(x)).toBe(PREVIEW_LIMITS.revealResponseBytes);
  expect(
    previewRevealResponseSchema.safeParse({ ok: true, value: x }).success,
  ).toBe(true);
  spare!.set(spare!.get() + "a");
  expect(previewRevealSchema.safeParse(x).success).toBe(true);
  expect(
    previewRevealResponseSchema.safeParse({ ok: true, value: x }).success,
  ).toBe(false);
});
