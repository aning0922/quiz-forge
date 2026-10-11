import { describe, expect, it } from "vitest";
import {
  prepareSevenDesireStudy,
  sevenDesireFixture as fixture,
  sevenDesireDimensionIds,
  type SevenDesireStudyView,
} from "./seven-desire-fixture";

const withScore = (score: unknown): SevenDesireStudyView =>
  ({
    ...fixture,
    atlas: {
      ...fixture.atlas,
      dimensions: fixture.atlas.dimensions.map((dimension, index) =>
        index === 0 ? { ...dimension, normalizedScore: score } : dimension,
      ),
    },
  }) as SevenDesireStudyView;

describe("seven-desire synthetic presentation boundary", () => {
  it("preserves exact input and editorial references even when scores disagree", () => {
    const input = structuredClone(fixture);
    const before = JSON.stringify(input);
    expect(prepareSevenDesireStudy(input)).toBe(input);
    expect(JSON.stringify(input)).toBe(before);
    const changed = withScore(0);
    expect(prepareSevenDesireStudy(changed).topDimensionIds).toEqual(
      fixture.topDimensionIds,
    );
    expect(changed.identity).toBe(fixture.identity);
    expect(changed.atlas.dimensions.map((item) => item.dimensionId)).toEqual([
      ...sevenDesireDimensionIds,
    ]);
  });

  it.each([0, 0.5, 49.99, 100])("accepts exact boundary %s", (score) => {
    const input = withScore(score);
    expect(
      prepareSevenDesireStudy(input).atlas.dimensions[0]!.normalizedScore,
    ).toBe(score);
  });

  it.each([-1, 100.01, NaN, Infinity, -Infinity, "88", null, undefined])(
    "rejects invalid score %s without fallback or coercion",
    (score) =>
      expect(() => prepareSevenDesireStudy(withScore(score))).toThrow(),
  );

  it("rejects missing, duplicate, unknown and reordered dimension meaning", () => {
    const dimensions = fixture.atlas.dimensions;
    const invalid = [
      dimensions.slice(0, 6),
      dimensions.map((item, index) =>
        index === 1 ? { ...item, dimensionId: "pride" } : item,
      ),
      dimensions.map((item, index) =>
        index === 1 ? { ...item, dimensionId: "unknown" } : item,
      ),
      dimensions.map((item, index) =>
        index === 0 ? { ...item, displayOrder: 7 } : item,
      ),
      dimensions.map((item, index) =>
        index === 0 ? { ...item, interpretation: "" } : item,
      ),
    ];
    for (const items of invalid) {
      expect(() =>
        prepareSevenDesireStudy({
          ...fixture,
          atlas: { ...fixture.atlas, dimensions: items },
        }),
      ).toThrow();
    }
  });

  it("rejects missing and duplicate editorial references", () => {
    for (const ids of [
      [],
      ["pride", "greed"],
      ["pride", "pride", "lust"],
      ["pride", "greed", "unknown"],
    ]) {
      expect(() =>
        prepareSevenDesireStudy({
          ...fixture,
          topDimensionIds: ids,
        } as SevenDesireStudyView),
      ).toThrow();
    }
  });

  it("rejects absent identity, narrative and synthetic source instead of substituting another character", () => {
    for (const field of ["name", "title", "declaration"] as const) {
      expect(() =>
        prepareSevenDesireStudy({
          ...fixture,
          identity: { ...fixture.identity, [field]: " " },
        }),
      ).toThrow();
    }
    const invalid = [
      null,
      { ...fixture, identity: undefined },
      { ...fixture, identity: { ...fixture.identity, archetypeId: "li-bai" } },
      { ...fixture, atlas: undefined },
      { ...fixture, source: "answers" },
      { ...fixture, kind: "real" },
      { ...fixture, displayId: "" },
      { ...fixture, disclosure: "娱乐性格测评" },
      { ...fixture, traits: [] },
      { ...fixture, relationships: [""] },
      { ...fixture, tensions: undefined },
      { ...fixture, strengths: [] },
      { ...fixture, imbalances: [] },
      { ...fixture, characterStory: " " },
    ];
    for (const value of invalid) {
      expect(() =>
        prepareSevenDesireStudy(value as unknown as SevenDesireStudyView),
      ).toThrow();
    }
  });
});
