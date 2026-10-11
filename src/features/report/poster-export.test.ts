import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { historicalDisplayFixture } from "./historical-display-fixture";
import { createHistoricalPosterView } from "./historical-poster-view";
import {
  layoutHistoricalPoster,
  validatePosterExport,
  verifyPosterFontCoverage,
} from "./poster-export";

const view = createHistoricalPosterView(historicalDisplayFixture);
const measure = (text: string, size: number) => [...text].length * size;

describe("bounded poster presentation", () => {
  it("places all blocks within the PNG text area without dropping any fields", () => {
    const blocks = layoutHistoricalPoster(view, measure);
    expect(blocks).toHaveLength(8);
    expect(blocks[0]!.top).toBeGreaterThanOrEqual(1220);
    expect(blocks.at(-1)!.bottom).toBeLessThanOrEqual(1868);
    expect(blocks.find((b) => b.key === "name")!.lines.join("")).toBe(
      view.identity.name,
    );
    for (const block of blocks)
      for (const line of block.lines)
        expect(measure(line, block.size)).toBeLessThanOrEqual(900);
  });
  it("wraps long names, titles and verse; rejects text exceeding the vertical budget", () => {
    const long = {
      ...view,
      identity: {
        ...view.identity,
        name: "行路者".repeat(5),
        title: "浪漫自由".repeat(7),
      },
      inscription: {
        ...view.inscription,
        lines: ["心有远方".repeat(4), "星月作行囊".repeat(3)],
      },
    };
    const blocks = layoutHistoricalPoster(long, measure);
    expect(blocks.find((b) => b.key === "name")!.lines.length).toBeGreaterThan(
      1,
    );
    expect(blocks.find((b) => b.key === "title")!.lines.length).toBeGreaterThan(
      1,
    );
    expect(blocks.at(-1)!.bottom).toBeLessThanOrEqual(1868);
    expect(() =>
      layoutHistoricalPoster(
        {
          ...long,
          identity: {
            name: "心".repeat(80),
            title: "心".repeat(80),
            era: "心".repeat(80),
          },
          inscription: {
            ...view.inscription,
            lines: ["心".repeat(80), "心".repeat(80)],
          },
        },
        measure,
      ),
    ).toThrow("文字过长");
  });
  it("rejects malformed, remote, unknown and prototype artwork references", () => {
    for (const assetId of ["unknown", "__proto__", "constructor"])
      expect(() =>
        validatePosterExport({
          ...view,
          artwork: { ...view.artwork, assetId },
        }),
      ).toThrow("人物画作未登记");
    expect(() =>
      validatePosterExport({
        ...view,
        artwork: { ...view.artwork, src: "https://example.com/image.png" },
      }),
    ).toThrow("地址与登记不一致");
    expect(() =>
      validatePosterExport({
        ...view,
        identity: { ...view.identity, title: "" },
      }),
    ).toThrow("资料不完整");
    expect(() => validatePosterExport({ ...view, disclosure: "" })).toThrow(
      "资料不完整",
    );
    expect(() =>
      validatePosterExport({
        ...view,
        tendencies: [...view.tendencies, view.tendencies[0]!],
      }),
    ).toThrow("性情倾向");
    expect(() =>
      validatePosterExport({
        ...view,
        tendencies: view.tendencies.map((t) => ({
          ...t,
          normalizedScore: NaN,
        })),
      }),
    ).toThrow("性情倾向");
    expect(() => validatePosterExport({ ...view, tendencies: [] })).toThrow(
      "资料不完整",
    );
  });
  it("covers every drawn character with the audited font list and rejects unsupported glyphs", () => {
    const characters = readFileSync(
      "public/assets/fonts/visual-v2-c/characters.txt",
      "utf8",
    );
    expect(() => verifyPosterFontCoverage(view, characters)).not.toThrow();
    expect(() =>
      verifyPosterFontCoverage(
        { ...view, identity: { ...view.identity, name: "龘" } },
        characters,
      ),
    ).toThrow("字体不包含");
    expect(() =>
      verifyPosterFontCoverage(
        { ...view, identity: { ...view.identity, name: "!" } },
        characters,
      ),
    ).toThrow("字体不包含");
  });
});
