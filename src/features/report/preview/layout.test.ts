import { describe, it, expect } from "vitest";
import {
  previewFixture,
  sourceBinding,
  answers,
  requestId,
  expandDimensions,
} from "@/features/theme/preview/fixtures.test-support";
import {
  preparePreviewContent,
  scorePreview,
} from "@/features/theme/preview/projection";
import type { DisplayPosterExportBodyV1 } from "@/lib/assessment-contract/display-v1";
import { layoutPreviewPoster, wrapPosterText, PREVIEW_MARK } from "./layout";
const measure = (text: string, size: number) => [...text].length * size;
async function input(): Promise<DisplayPosterExportBodyV1> {
  const c = await previewFixture();
  expandDimensions(c, 4);
  const p = preparePreviewContent(c, sourceBinding(c));
  if (!p.ok) throw Error(p.code);
  const r = scorePreview(p.value.prepared, answers(c), requestId);
  if (!r.ok || r.value.poster.kind !== "ready") throw Error("fixture");
  const v = r.value;
  return {
    answersHash: v.answersHash,
    logicHash: v.logicHash,
    selectedResultRef: v.selectedResultRef,
    reportTemplateRef: v.reportTemplateRef,
    poster: v.poster as DisplayPosterExportBodyV1["poster"],
  };
}
describe("bounded complete poster text", () => {
  it("keeps every character and explicit line and rejects overflow without truncation", () => {
    expect(wrapPosterText("甲乙\n丙丁", 32, 64, 2, measure)).toEqual([
      "甲乙",
      "丙丁",
    ]);
    expect(wrapPosterText("甲乙丙丁", 32, 64, 2, measure).join("")).toBe(
      "甲乙丙丁",
    );
    expect(() => wrapPosterText("甲乙丙丁戊", 32, 64, 2, measure)).toThrow(
      "POSTER_LIMIT_EXCEEDED",
    );
    expect(() => wrapPosterText("甲", 32, 31, 1, measure)).toThrow(
      "POSTER_LIMIT_EXCEEDED",
    );
  });
  it("lays out maximum fields and all four dimensions inside the independent text area", async () => {
    const value = structuredClone(await input());
    value.poster.displayName = "甲".repeat(12);
    value.poster.subtitle = "乙".repeat(24);
    value.poster.posterLine.text = "丙".repeat(48);
    value.poster.posterDisclosure = "丁".repeat(72);
    value.poster.dimensions.forEach((d) => {
      d.label = "维".repeat(8);
    });
    const blocks = layoutPreviewPoster(value, measure);
    expect(
      blocks.every(
        (b) =>
          b.x >= 90 &&
          b.y >= 1220 &&
          b.y + b.size <= 1868 &&
          measure(b.text, b.size) <= 900,
      ),
    ).toBe(true);
    expect(blocks.map((b) => b.text).join("")).toContain("丙".repeat(48));
    expect(blocks.filter((b) => b.text.startsWith("维"))).toHaveLength(4);
    expect(blocks.at(-1)?.text).toBe(PREVIEW_MARK);
  });
  it("actual measurement can reject structurally legal text; no silent shrinking or clipping", async () => {
    const value = structuredClone(await input());
    expect(() => layoutPreviewPoster(value, () => 1000)).toThrow(
      "POSTER_LIMIT_EXCEEDED",
    );
  });
});
