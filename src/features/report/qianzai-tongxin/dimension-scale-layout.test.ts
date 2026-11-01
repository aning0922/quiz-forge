import { describe, expect, it } from "vitest";
import { qianzaiPresentationFixture } from "./result-presentation.test-support";
import { layoutQianzaiExport, qianzaiExportText, type Measure } from "./layout";
import {
  qianzaiDimensionScale,
  QIANZAI_SCALE_HEADING,
} from "./dimension-scale";
import { deriveQianzaiResultPresentation } from "./result-presentation";
const measure: Measure = (s, size) => ({
  width: [...s].length * size,
  left: 0,
  right: [...s].length * size,
  ascent: size * 0.8,
  descent: size * 0.2,
});
describe("Qianzai same-source full-report scales", () => {
  it("prints all fixed explanations with real positions and preserves six volumes and both evidence directions", async () => {
    const f = await qianzaiPresentationFixture();
    const scores = [0, 44, 46, 56, 100];
    f.body.dimensions.forEach((d, i) => {
      d.score = scores[i]!;
    });
    const p = f.body.volumes[3]!.paragraphs[0]!;
    p.counterevidence = [
      {
        ...f.body.volumes[2]!.paragraphs[0]!.evidence[0]!,
        prompt: "反向题干",
        optionText: "反向选择",
        scope: "仅本轮反向记录",
      },
    ];
    const before = structuredClone(f.body);
    const presentation = deriveQianzaiResultPresentation(f.view, f.binding)!;
    const layout = layoutQianzaiExport(
      f.body,
      "full-report",
      measure,
      undefined,
      { presentation },
    );
    const text = layout.operations
      .filter((op) => op.kind === "text")
      .map((op) => op.text)
      .join("");
    const fontInput = qianzaiExportText(
      f.body,
      "full-report",
      presentation,
    ).join("");
    const bars = layout.operations.filter((op) => op.kind === "bar");
    expect(bars).toHaveLength(5);
    f.body.dimensions.forEach((d, i) => {
      const scale = qianzaiDimensionScale(
        d,
        f.body.provenance.canonicalContentSha256,
      )!;
      expect(bars[i]).toMatchObject({ score: d.score, scale: scale.geometry });
      for (const s of [
        scale.left,
        scale.right,
        scale.positionLabel,
        scale.caption,
        scale.explanation,
      ]) {
        expect(text).toContain(s);
        expect(fontInput).toContain(s);
      }
      expect(text.split(scale.explanation)).toHaveLength(2);
    });
    for (const v of f.body.volumes)
      for (const paragraph of v.paragraphs) {
        expect(text).toContain(paragraph.text);
        for (const evidence of [
          ...paragraph.evidence,
          ...paragraph.counterevidence,
        ]) {
          for (const value of [
            evidence.prompt,
            evidence.optionText,
            evidence.scope,
          ])
            expect(text).toContain(value);
        }
      }
    expect(layout.height).toBeLessThanOrEqual(16384);
    expect(f.body).toEqual(before);
  });
  it("leaves poster output independent from scale source support and does not assign explanations to unknown source", async () => {
    const f = await qianzaiPresentationFixture();
    const supported = layoutQianzaiExport(f.body, "poster", measure);
    const supportedText = qianzaiExportText(f.body, "poster");
    f.body.provenance.canonicalContentSha256 = "0".repeat(64);
    expect(layoutQianzaiExport(f.body, "poster", measure)).toEqual(supported);
    expect(qianzaiExportText(f.body, "poster")).toEqual(supportedText);
    const unknown = layoutQianzaiExport(f.body, "full-report", measure);
    expect(unknown.operations.some((op) => op.kind === "bar" && op.scale)).toBe(
      false,
    );
    expect(qianzaiExportText(f.body, "full-report")).not.toContain(
      QIANZAI_SCALE_HEADING,
    );
  });
});
