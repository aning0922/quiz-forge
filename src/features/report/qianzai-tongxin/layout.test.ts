import { beforeAll, describe, expect, it } from "vitest";
import { qianzaiExportFixture } from "./export.test-support";
import { layoutQianzaiExport, qianzaiExportText, type Measure } from "./layout";
import { qianzaiSnapshotDocument } from "./presentation";
import { qianzaiPresentationFixture } from "./result-presentation.test-support";
import { deriveQianzaiResultPresentation } from "./result-presentation";
let fixture: Awaited<ReturnType<typeof qianzaiExportFixture>>;
beforeAll(async () => {
  fixture = await qianzaiExportFixture();
});
const measure: Measure = (s, size) => ({
  width: [...s].length * size,
  left: 0,
  right: [...s].length * size,
  ascent: size * 0.8,
  descent: size * 0.2,
});
describe("Qianzai complete-report layout", () => {
  it("prints complete registered short groups without taking or truncating the long opening prose", async () => {
    for (const id of [
      "li-bai",
      "su-shi",
      "tao-yuanming",
      "li-qingzhao",
      "mulan-ballad",
    ]) {
      const f = await qianzaiPresentationFixture();
      f.body.matching.selected.ref.id = id;
      f.view.display.selectedResultRef = { ...f.body.matching.selected.ref };
      f.body.matching.status = "near-tie";
      if (id === "mulan-ballad")
        f.body.matching.selected.kind = "literary-legendary";
      f.body.volumes[0]!.paragraphs[0]!.text =
        "不应被截取成海报摘要的长报告正文。".repeat(100);
      const presentation = deriveQianzaiResultPresentation(f.view, f.binding)!;
      const result = layoutQianzaiExport(f.body, "poster", measure, undefined, {
        presentation,
      });
      const text = result.operations
        .filter((op) => op.kind === "text")
        .map((op) => op.text)
        .join("");
      for (const line of [
        ...presentation.poster.lines,
        presentation.quote.text,
        presentation.quote.source,
      ])
        expect(text).toContain(line);
      expect(text).not.toContain("不应被截取");
      expect(text).toContain("前两位人物接近");
      expect(result.operations.some((op) => op.kind === "seal")).toBe(true);
      expect(result.height).toBe(1672);
    }
  });
  it("uses the same registered role identity, verse and history as the reader while retaining all sealed prose", async () => {
    const f = await qianzaiPresentationFixture(),
      body = f.body;
    const before = structuredClone(body);
    const presentation = deriveQianzaiResultPresentation(f.view, f.binding)!;
    const doc = qianzaiSnapshotDocument(body, undefined, presentation);
    const result = layoutQianzaiExport(
      body,
      "full-report",
      measure,
      undefined,
      { presentation },
    );
    const text = result.operations
      .filter((op) => op.kind === "text")
      .map((op) => op.text)
      .join("");
    for (const value of [
      doc.name,
      doc.subtitle,
      doc.identity!.verse!.text,
      doc.identity!.verse!.source,
      ...doc.history!.timeline.flatMap((row) => [row.title, row.text]),
      ...body.volumes.flatMap((volume) =>
        volume.paragraphs.map((paragraph) => paragraph.text),
      ),
    ]) {
      expect(text.replaceAll("\n", "")).toContain(value.replaceAll("\n", ""));
    }
    expect(qianzaiExportText(body, "full-report", presentation)).toContain(
      doc.identity!.verse!.source,
    );
    expect(body).toEqual(before);
  });
  it("reserves a measured footer for the test annotation without covering the title or changing report facts", () => {
    for (const kind of ["poster", "full-report"] as const) {
      const plain = layoutQianzaiExport(fixture.body, kind, measure);
      const annotated = layoutQianzaiExport(
        fixture.body,
        kind,
        measure,
        undefined,
        { annotation: "测试素材 · 候选正文" },
      );
      const originalText = plain.operations.filter((o) => o.kind === "text");
      const nextText = annotated.operations.filter((o) => o.kind === "text");
      expect(nextText.slice(0, -1).map((o) => o.text)).toEqual(
        originalText.map((o) => o.text),
      );
      expect(nextText[0]).toEqual(originalText[0]);
      const footer = nextText.at(-1)!;
      expect(footer.text).toBe("测试素材 · 候选正文");
      expect(footer.y).toBeGreaterThan(nextText.at(-2)!.y + 4);
      expect(footer.y + footer.size * 0.2).toBeLessThan(annotated.height - 20);
      if (kind === "poster") expect(annotated.height).toBe(1672);
      else expect(annotated.height).toBeGreaterThan(plain.height);
    }
  });
  it("draws all five actual scores on the fixed poster, with no fixed 89 or QR", () => {
    const body = structuredClone(fixture.body);
    body.matching.selected.narrativeIndex = 43;
    const layout = layoutQianzaiExport(body, "poster", measure);
    expect([layout.width, layout.height]).toEqual([941, 1672]);
    expect(layout.operations.find((o) => o.kind === "radar")).toMatchObject({
      scores: body.dimensions.map((d) => d.score),
    });
    const text = layout.operations
      .filter((o) => o.kind === "text")
      .map((o) => o.text)
      .join("");
    expect(text).toContain("43");
    expect(text).not.toContain("二维码");
    expect(text).not.toContain("89%");
  });
  it("measures every paragraph and evidence through the last volume, grows height and does not append raw answers", () => {
    const body = structuredClone(fixture.body);
    body.volumes[5]!.paragraphs[0]!.text = "末卷全文".repeat(100);
    body.volumes[3]!.paragraphs[0]!.evidence = [
      {
        questionRef: body.answers[0]!.questionRef,
        optionRef: body.answers[0]!.optionRef,
        scope: "证据范围",
        prompt: "唯一题干",
        optionText: "唯一选项",
      },
    ];
    const short = layoutQianzaiExport(fixture.body, "full-report", measure);
    const layout = layoutQianzaiExport(body, "full-report", measure);
    expect(layout.height).toBeGreaterThan(short.height);
    const text = layout.operations
      .filter((o) => o.kind === "text")
      .map((o) => o.text)
      .join("");
    expect(text.match(/末卷全文/g)).toHaveLength(100);
    expect(text).toContain("唯一题干唯一选项");
    expect(text).not.toContain(body.answers[1]!.prompt);
    expect(layout.operations.filter((o) => o.kind === "bar")).toHaveLength(5);
  });
  it("preserves single/near-tie and paragraph evidence limitations, with labelled runner-up", () => {
    const body = structuredClone(fixture.body);
    body.matching.status = "single-candidate";
    body.volumes[0]!.paragraphs[0]!.status = "fallback";
    const poster = layoutQianzaiExport(body, "poster", measure)
      .operations.filter((o) => o.kind === "text")
      .map((o) => o.text)
      .join("");
    expect(poster).toContain("本轮偏好下仅有一位候选人物。");
    expect(poster).toContain("证据不足时的说明");
    body.matching.status = "near-tie";
    body.matching.runnerUp = {
      ...body.matching.selected,
      label: "第二人物",
      narrativeIndex: 72,
    };
    const full = layoutQianzaiExport(body, "full-report", measure)
      .operations.filter((o) => o.kind === "text")
      .map((o) => o.text)
      .join("");
    expect(full).toContain("前两位人物接近，这是一种开放的文学类比。");
    expect(full).toContain("第二候选：第二人物 · 契合指数 72 / 100");
    expect(full).toContain("证据不足时的说明");
    expect(full).toContain("本轮事实");
    const coverage = new Set(qianzaiExportText(body, "full-report").join(""));
    expect([...full].filter((c) => !coverage.has(c))).toEqual([]);
  });
  it("accepts valid signed ink metrics for punctuation without losing text", () => {
    const signed: Measure = (value, size) => ({
      ...measure(value, size),
      descent: value === "·" ? -6 : size * 0.2,
    });
    const layout = layoutQianzaiExport(fixture.body, "full-report", signed);
    expect(
      layout.operations
        .filter((o) => o.kind === "text")
        .map((o) => o.text)
        .join(""),
    ).toContain("本轮事实 · 本轮情境");
  });
  it("rejects height/character/width overflow and non-finite metrics instead of truncating", () => {
    const body = structuredClone(fixture.body);
    body.volumes.forEach((v) => {
      v.paragraphs[0]!.text = "满".repeat(4000);
    });
    expect(() => layoutQianzaiExport(body, "full-report", measure)).toThrow(
      "CONTENT_LIMIT",
    );
    expect(() =>
      layoutQianzaiExport(fixture.body, "poster", () => ({
        width: Infinity,
        left: 0,
        right: 0,
        ascent: 0,
        descent: 0,
      })),
    ).toThrow("CONTENT_LIMIT");
    expect(() =>
      layoutQianzaiExport(fixture.body, "poster", (s, size) => ({
        ...measure(s, size),
        width: 10000,
      })),
    ).toThrow("CONTENT_LIMIT");
  });
  it("includes every actual print string in font coverage inputs", () => {
    for (const kind of ["poster", "full-report"] as const) {
      const source = new Set(qianzaiExportText(fixture.body, kind).join(""));
      const actual = layoutQianzaiExport(fixture.body, kind, measure)
        .operations.filter((o) => o.kind === "text")
        .map((o) => o.text)
        .join("");
      expect([...actual].filter((c) => !source.has(c))).toEqual([]);
    }
  });
});
