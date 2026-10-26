import { describe, expect, it } from "vitest";
import { syntheticContentV3 } from "@/features/quizpack/content/v3-fixtures.test-support";
import {
  prepareContentV3,
  scorePreparedContentV3,
  inspectScoredClaimV3,
} from "@/features/quizpack/content/v3-scoring-adapter";
import {
  syntheticInputV2,
  syntheticRef,
} from "@/features/quiz/scoring/v2/fixtures.test-support";
import { estimateContentReportBudgetV3 } from "@/features/quizpack/content/v3-budget";
import {
  projectContentEntryV3,
  projectPreparedResultV3,
} from "@/features/theme/preview/v3-projection";
import { composePreparedReportV3 } from "./compose";
import type { V2Result } from "@/lib/assessment-contract/scoring-api-v2";
function good<T>(r: V2Result<T>): T {
  expect(r.ok).toBe(true);
  if (!r.ok) throw Error("EXPECTED_SUCCESS");
  return r.value;
}
describe("fixed six-volume composition and resource ownership", () => {
  it("seals six volumes, actual choices and downgrade states within the admission bound", () => {
    const c = syntheticContentV3();
    c.core.questions[0]!.prompt = 'Quoted "scenario"\n🙂';
    const h = good(prepareContentV3(c)),
      budget = estimateContentReportBudgetV3(c);
    for (const [choices, status] of [
      [[2, 2, 2], "accepted"],
      [[2, 2, 0], "facts-only"],
      [[0, 0, 0], "fallback"],
    ] as const) {
      const r = good(
        composePreparedReportV3(h, syntheticInputV2(3, [...choices])),
      );
      expect(r.body.volumes).toHaveLength(6);
      expect(r.body.volumes[0]!.paragraphs[0]!.status).toBe(status);
      expect(r.body.answers[0]!.prompt).toBe('Quoted "scenario"\n🙂');
      expect(r.body.answers.map((a) => a.optionRef.id)).toEqual(
        choices.map((v, i) => `q-${i}-o-${v}`),
      );
      expect(Buffer.byteLength(JSON.stringify(r.body))).toBeLessThanOrEqual(
        budget.templateBounds[0]!.bodyUpperBound,
      );
      expect(Object.isFrozen(r.body.volumes[0]!.paragraphs)).toBe(true);
    }
  });
  it("does not accept round-tripped or foreign score facts as execution proof", () => {
    const c = syntheticContentV3(),
      h = good(prepareContentV3(c)),
      input = syntheticInputV2(3, [2, 2, 2]);
    const score = good(scorePreparedContentV3(h, input));
    expect(
      inspectScoredClaimV3(h, structuredClone(score), "template", "claim").ok,
    ).toBe(false);
    expect(
      inspectScoredClaimV3(
        good(prepareContentV3(c)),
        score,
        "template",
        "claim",
      ).ok,
    ).toBe(false);
  });
  it("projects neutral resources before completion and only the selected character afterward", () => {
    const c = syntheticContentV3(),
      h = good(prepareContentV3(c));
    const r = good(projectPreparedResultV3(h, syntheticInputV2(3, [2, 2, 2])));
    expect(r.display.assets.map((a) => a.resourceRef.id).sort()).toEqual(
      ["cover", "scene", "portrait-second", "name-second"].sort(),
    );
    const entry = good(
      projectContentEntryV3(c, r.score.canonicalContentSha256),
    );
    expect(entry.assets.map((a) => a.resourceRef.id).sort()).toEqual([
      "cover",
      "scene",
    ]);
    expect(JSON.stringify(entry)).not.toContain("contributions");
    c.bindings.slots.characters[0]!.nameArt =
      c.bindings.slots.characters[1]!.nameArt;
    expect(prepareContentV3(c).ok).toBe(false);
  });
  it("rejects oversized worst-case text at preparation, including JSON escaping and repeated evidence", () => {
    const c = syntheticContentV3(),
      t = c.bindings.reportTemplates[0]!;
    t.claims = Array.from({ length: 16 }, (_, i) => ({
      ...structuredClone(t.claims[0]!),
      ref: syntheticRef(`claim-${i}`),
      text: '"'.repeat(4000),
    }));
    for (const v of t.volumes) {
      v.claimRefs = t.claims.map((c) => c.ref);
      v.maxClaims = 16;
    }
    expect(estimateContentReportBudgetV3(c).ok).toBe(false);
    expect(prepareContentV3(c)).toMatchObject({
      ok: false,
      issues: [{ code: "INPUT_LIMIT_EXCEEDED" }],
    });
  });
});
