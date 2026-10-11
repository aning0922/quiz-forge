import { describe, expect, it } from "vitest";
import {
  getStudyInscription,
  historicalInscriptionCandidates,
} from "./historical-inscriptions";
import {
  inscriptionAttribution,
  validateInscription,
  type TemperamentInscription,
} from "./temperament-inscription";

describe("independent temperament inscriptions", () => {
  it("has multiple explicit candidates for one archetype without a score selector", () => {
    expect(historicalInscriptionCandidates).toHaveLength(2);
    expect(
      historicalInscriptionCandidates.every((c) =>
        c.forArchetypes.includes("historical.li-bai"),
      ),
    ).toBe(true);
    expect(getStudyInscription("none")).toBeNull();
  });
  it("keeps verified author, work and exact source separate from original prose", () => {
    const classical = getStudyInscription("classical")!;
    const original = getStudyInscription("original")!;
    expect(validateInscription(classical)).toBe(true);
    expect(validateInscription(original)).toBe(true);
    expect(classical.lines).toEqual(["长风破浪会有时，", "直挂云帆济沧海。"]);
    expect(inscriptionAttribution(classical)).toBe("李白《行路难·其一》");
    expect(inscriptionAttribution(original)).toContain("原创拟古");
    expect(original).not.toHaveProperty("author");
    expect(original).not.toHaveProperty("source");
  });
  it("does not accept fabricated attribution or a poster line absent from the excerpt", () => {
    const classical = getStudyInscription("classical")!;
    const original = getStudyInscription("original")!;
    for (const bad of [
      { ...classical, author: "" },
      { ...classical, source: null },
      {
        ...classical,
        source: {
          title: "source",
          url: "javascript:alert(1)",
          verifiedOn: "2026-10-11",
        },
      },
      { ...classical, posterLine: "不存在的句子" },
      { ...original, author: "李白" },
      { ...original, lines: ["仅一行"] },
    ])
      expect(
        validateInscription(bad as unknown as TemperamentInscription),
      ).toBe(false);
  });
});
