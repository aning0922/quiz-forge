import { describe, expect, it } from "vitest";
import { historicalDisplayFixture as source } from "./historical-display-fixture";
import { createHistoricalPosterView } from "./historical-poster-view";
import { getStudyInscription } from "./historical-inscriptions";

describe("read-only poster adapter", () => {
  it("copies the report identity, inscription provenance and exact referenced atlas values", () => {
    const view = createHistoricalPosterView(source);
    expect(view.fixtureId).toBe(source.displayId);
    expect(view.identity.name).toBe(source.report.identity.name);
    expect(view.identity.title).toBe(source.report.identity.title);
    expect(view.inscription.lines).toEqual(source.inscription!.lines);
    for (const tendency of view.tendencies) {
      const dimension = source.atlas.dimensions.find(
        (d) => d.dimensionId === tendency.dimensionId,
      )!;
      expect(tendency.normalizedScore).toBe(dimension.normalizedScore);
    }
    expect(Object.keys(view).sort()).toEqual([
      "artwork",
      "brand",
      "disclosure",
      "fixtureId",
      "identity",
      "inscription",
      "kind",
      "tendencies",
    ]);
    expect(view.disclosure).toContain("合成演示");
  });
  it("retains original inscription provenance rather than attributing it to the historical character", () => {
    const view = createHistoricalPosterView({
      ...source,
      inscription: getStudyInscription("original"),
    });
    expect(view.inscription.kind).toBe("original");
    expect(view.inscription.attribution).toContain("原创拟古");
  });
  it("fails on missing identity/inscription and unknown artwork, without a substitute portrait", () => {
    for (const field of ["name", "title", "era"] as const) {
      expect(() =>
        createHistoricalPosterView({
          ...source,
          report: {
            ...source.report,
            identity: { ...source.report.identity, [field]: "" },
          },
        }),
      ).toThrow("人物身份资料不完整");
    }
    expect(() =>
      createHistoricalPosterView({ ...source, inscription: null }),
    ).toThrow("题签及出处资料不完整");
    expect(() =>
      createHistoricalPosterView({
        ...source,
        report: {
          ...source.report,
          identity: {
            ...source.report.identity,
            portraitAssetId: "unregistered-person",
          },
        },
      }),
    ).toThrow("人物画作未登记");
  });
  it("rejects invalid display references and scores rather than inventing replacements", () => {
    expect(() =>
      createHistoricalPosterView({
        ...source,
        copy: {
          ...source.copy,
          posterDimensions: [
            { dimensionId: "missing", shortLabel: "未知" },
            source.copy.posterDimensions[0]!,
          ],
        },
      }),
    ).toThrow("Unknown dimension");
    expect(() =>
      createHistoricalPosterView({
        ...source,
        atlas: {
          ...source.atlas,
          dimensions: source.atlas.dimensions.map((d, i) =>
            i === 0 ? { ...d, normalizedScore: 101 } : d,
          ),
        },
      }),
    ).toThrow("Invalid atlas dimension");
    expect(() =>
      createHistoricalPosterView({
        ...source,
        copy: { ...source.copy, posterDimensions: [] },
      }),
    ).toThrow("两至三项");
    expect(() =>
      createHistoricalPosterView({ ...source, displayId: "" }),
    ).toThrow("人物身份资料不完整");
  });
});
