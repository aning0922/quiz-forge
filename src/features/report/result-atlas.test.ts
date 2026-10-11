import { describe, expect, it } from "vitest";
import {
  getAtlasSample,
  historicalAtlasFixture,
} from "./historical-atlas-fixture";
import {
  prepareResultAtlas,
  referencedDimensions,
  type ResultAtlasView,
} from "./result-atlas";

describe("synthetic result atlas display boundary", () => {
  it.each(["four", "five", "seven", "long"] as const)(
    "accepts %s without changing values or order",
    (sample) => {
      const input = getAtlasSample(sample);
      const before = JSON.stringify(input);
      const dimensions = prepareResultAtlas(input);
      expect(dimensions).toHaveLength(
        sample === "four" ? 4 : sample === "five" ? 5 : 7,
      );
      expect(dimensions.map((d) => d.normalizedScore)).toEqual(
        input.dimensions.map((d) => d.normalizedScore),
      );
      expect(JSON.stringify(input)).toBe(before);
    },
  );
  it("keeps zero, midpoint, full scale and fractional boundaries exact", () => {
    const boundaries = [0, 0.5, 49.99, 50, 50.01, 99.5, 100];
    const input = {
      ...getAtlasSample("seven"),
      dimensions: getAtlasSample("seven").dimensions.map((d, i) => ({
        ...d,
        normalizedScore: boundaries[i]!,
      })),
    };
    expect(prepareResultAtlas(input).map((d) => d.normalizedScore)).toEqual(
      boundaries,
    );
  });
  it.each([-1, 100.01, NaN, Infinity, -Infinity, "88", null, undefined])(
    "rejects invalid score %s instead of clamping or inventing zero",
    (score) => {
      const input = {
        ...historicalAtlasFixture,
        dimensions: historicalAtlasFixture.dimensions.map((d, i) =>
          i ? d : { ...d, normalizedScore: score },
        ),
      } as ResultAtlasView;
      expect(() => prepareResultAtlas(input)).toThrow();
    },
  );
  it("sorts a copy by editorial order without ranking by score or mutating a frozen input", () => {
    const input = Object.freeze({
      ...historicalAtlasFixture,
      dimensions: Object.freeze(
        [...historicalAtlasFixture.dimensions].reverse(),
      ),
    });
    const sorted = prepareResultAtlas(input);
    expect(sorted.map((d) => d.dimensionId)).toEqual(
      historicalAtlasFixture.dimensions.map((d) => d.dimensionId),
    );
    expect(input.dimensions[0]!.dimensionId).toBe("steadiness");
  });
  it("rejects unsupported counts, duplicate references and missing meaning", () => {
    for (const dimensions of [
      historicalAtlasFixture.dimensions.slice(0, 3),
      [
        ...getAtlasSample("seven").dimensions,
        historicalAtlasFixture.dimensions[0]!,
      ],
    ])
      expect(() =>
        prepareResultAtlas({ ...historicalAtlasFixture, dimensions }),
      ).toThrow();
    for (const change of [
      { dimensionId: "expression" },
      { displayOrder: 2 },
      { displayOrder: 1.5 },
      { displayOrder: -1 },
      { label: "" },
      { interpretation: " " },
      { scaleDescription: "" },
      { lowLabel: "" },
      { highLabel: "" },
    ]) {
      expect(() =>
        prepareResultAtlas({
          ...historicalAtlasFixture,
          dimensions: historicalAtlasFixture.dimensions.map((d, i) =>
            i ? d : { ...d, ...change },
          ),
        }),
      ).toThrow();
    }
    expect(() =>
      prepareResultAtlas({
        ...historicalAtlasFixture,
        kind: "real",
      } as unknown as ResultAtlasView),
    ).toThrow();
  });
  it("only resolves explicitly configured evidence and poster dimensions", () => {
    expect(
      referencedDimensions(historicalAtlasFixture, [
        "steadiness",
        "exploration",
      ]).map((d) => d.normalizedScore),
    ).toEqual([38, 88]);
    for (const ids of [[], ["missing"], ["exploration", "exploration"]])
      expect(() => referencedDimensions(historicalAtlasFixture, ids)).toThrow();
  });
});
