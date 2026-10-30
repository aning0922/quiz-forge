import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalV2 } from "@/features/quiz/scoring/v2/boundary";
import { syntheticInputV2 } from "@/features/quiz/scoring/v2/fixtures.test-support";
import {
  prepareContentV3,
  scorePreparedContentV3,
  inspectComposedClaimV3,
} from "./v3-scoring-adapter";
import {
  inspectBuildInputV3,
  validateContentV3,
  validateCoreV3,
} from "./v3-references";
import { convertEditorialV05 } from "./v3-editorial-import";
import {
  syntheticContentV3,
  syntheticClaim,
  syntheticEditorialV05,
} from "./v3-fixtures.test-support";
import type { V2Result } from "@/lib/assessment-contract/scoring-api-v2";
function good<T>(result: V2Result<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error("EXPECTED_SUCCESS");
  return result.value;
}
function rawImport(s = syntheticEditorialV05()) {
  return {
    questionsJson: s.questionsJson,
    personasJson: s.personasJson,
    familiesJson: s.familiesJson,
    productId: s.productId,
    version: s.version,
    title: s.title,
  };
}
describe("v3 offline content and composed evidence contract", () => {
  it("separates core/content/admission even with complete synthetic bindings", () => {
    const c = syntheticContentV3();
    expect(inspectBuildInputV3(c.core)).toMatchObject({
      coreValid: true,
      contentValid: false,
      importable: false,
      missingBindings: [
        "report-templates",
        "character-slots",
        "resources",
        "layouts",
        "visual-presentation",
      ],
    });
    expect(inspectBuildInputV3(c.core, c.bindings)).toEqual({
      coreValid: true,
      contentValid: true,
      importable: false,
      missingBindings: [],
      issues: [],
    });
    const h = good(prepareContentV3(c));
    expect(
      good(scorePreparedContentV3(h, syntheticInputV2(3, [2, 2, 2])))
        .canonicalContentSha256,
    ).toBe(createHash("sha256").update(canonicalV2(c)).digest("hex"));
    expect(
      good(scorePreparedContentV3(h, syntheticInputV2(3, [2, 2, 2]))),
    ).toMatchObject({
      contentSchemaVersion: "quizpack-content.v3",
      reportTemplateRef: { id: "template" },
    });
    expect(scorePreparedContentV3({} as typeof h, syntheticInputV2(3)).ok).toBe(
      false,
    );
  });
  it("accepts bounded summaries only across core families without actual opposing core evidence", () => {
    const c = syntheticContentV3(),
      h = good(prepareContentV3(c));
    expect(
      good(
        inspectComposedClaimV3(
          h,
          syntheticInputV2(3, [2, 2, 2]),
          "template",
          "claim",
        ),
      ).status,
    ).toBe("accepted");
    expect(
      good(
        inspectComposedClaimV3(
          h,
          syntheticInputV2(3, [2, 2, 0]),
          "template",
          "claim",
        ),
      ).status,
    ).toBe("facts-only");
    c.core.evidenceFamilies.entries.forEach((e) => {
      e.family = "same-family";
    });
    expect(
      good(
        inspectComposedClaimV3(
          good(prepareContentV3(c)),
          syntheticInputV2(3, [2, 2, 2]),
          "template",
          "claim",
        ),
      ).status,
    ).toBe("facts-only");
  });
  it("keeps both actual answers and contexts for counterevidence cards", () => {
    const c = syntheticContentV3(syntheticClaim("context")),
      h = good(prepareContentV3(c));
    const result = good(
      inspectComposedClaimV3(
        h,
        syntheticInputV2(3, [2, 0, 1]),
        "template",
        "claim",
      ),
    );
    expect(result.status).toBe("accepted");
    expect(
      result.evidence.map((e) => [e.questionId, e.optionId, e.scope]),
    ).toEqual([
      ["q-0", "q-0-o-2", "Synthetic context 0"],
      ["q-1", "q-1-o-0", "Synthetic context 1"],
    ]);
    // Both qids exist in each input; changing only the counter-option must reject.
    expect(
      good(
        inspectComposedClaimV3(
          h,
          syntheticInputV2(3, [2, 2, 1]),
          "template",
          "claim",
        ),
      ),
    ).toEqual({ status: "not-matched", evidence: [] });
    expect(
      good(
        inspectComposedClaimV3(
          h,
          syntheticInputV2(3, [0, 0, 1]),
          "template",
          "claim",
        ),
      ),
    ).toEqual({ status: "not-matched", evidence: [] });
  });
  it("rejects cross-question evidence, duplicate families, wrong graph and missing fallback", () => {
    const c = syntheticContentV3();
    c.bindings.reportTemplates[0]!.claims[0]!.evidence[0]!.optionRef =
      c.core.questions[1]!.options[2]!.ref;
    expect(validateContentV3(c).ok).toBe(false);
    const other = syntheticContentV3();
    other.core.evidenceFamilies.entries.push(
      other.core.evidenceFamilies.entries[0]!,
    );
    expect(validateCoreV3(other.core).ok).toBe(false);
    const broken = syntheticContentV3();
    broken.bindings.slots.characters[0]!.report.id = "cover";
    expect(validateContentV3(broken).ok).toBe(false);
    const empty = syntheticContentV3();
    empty.bindings.reportTemplates[0]!.volumes[0]!.fallbackText = "";
    expect(validateContentV3(empty).ok).toBe(false);
  });
  it("does not promote a pending or unmatched literary bridge", () => {
    const c = syntheticContentV3();
    const claim = c.bindings.reportTemplates[0]!.claims[0]!;
    claim.kind = "literary";
    claim.literaryBridge = {
      roleRef: c.core.results[1]!.ref,
      grade: "weak",
      sources: [{ ref: claim.ref, sha256: "b".repeat(64) }],
      review: "pending",
    };
    expect(
      good(
        inspectComposedClaimV3(
          good(prepareContentV3(c)),
          syntheticInputV2(3, [2, 2, 2]),
          "template",
          "claim",
        ),
      ).status,
    ).toBe("facts-only");
  });
  it("keeps approved matched weak or absent literary bridges as facts-only", () => {
    const c = syntheticContentV3();
    const claim = c.bindings.reportTemplates[0]!.claims[0]!;
    claim.kind = "literary";
    for (const grade of ["weak", "none"] as const) {
      claim.literaryBridge = {
        roleRef: c.core.results[1]!.ref,
        grade,
        sources: [{ ref: claim.ref, sha256: "b".repeat(64) }],
        review: "approved",
      };
      const result = good(
        inspectComposedClaimV3(
          good(prepareContentV3(c)),
          syntheticInputV2(3, [2, 2, 2]),
          "template",
          "claim",
        ),
      );
      expect(result.status).toBe("facts-only");
      expect(result.evidence).toEqual([
        {
          questionId: "q-0",
          optionId: "q-0-o-2",
          text: "Synthetic choice 0/2",
          scope: "Synthetic context 0",
        },
        {
          questionId: "q-1",
          optionId: "q-1-o-2",
          text: "Synthetic choice 1/2",
          scope: "Synthetic context 1",
        },
      ]);
    }
  });
  it("accepts an approved matched medium literary bridge", () => {
    const c = syntheticContentV3();
    const claim = c.bindings.reportTemplates[0]!.claims[0]!;
    claim.kind = "literary";
    claim.literaryBridge = {
      roleRef: c.core.results[1]!.ref,
      grade: "medium",
      sources: [{ ref: claim.ref, sha256: "b".repeat(64) }],
      review: "approved",
    };
    const result = good(
      inspectComposedClaimV3(
        good(prepareContentV3(c)),
        syntheticInputV2(3, [2, 2, 2]),
        "template",
        "claim",
      ),
    );
    expect(result.status).toBe("accepted");
    expect(result.evidence.map((e) => e.optionId)).toEqual([
      "q-0-o-2",
      "q-1-o-2",
    ]);
  });
  it("converts invented 24-question data while rejecting conversion collisions and source drift", () => {
    const source = syntheticEditorialV05(),
      converted = good(convertEditorialV05(rawImport(source)));
    expect(converted.questions).toHaveLength(24);
    expect(converted.scoringDefinition.profiles).toHaveLength(5);
    expect(converted.questions[0]!.prompt).toBe(
      source.questions.questions[0]!.prompt,
    );
    const p = structuredClone(source.personas);
    p.characters[0]!.id = "role_1";
    expect(
      convertEditorialV05({
        ...rawImport(source),
        personasJson: JSON.stringify(p),
      }).ok,
    ).toBe(false);
    p.characters[0]!.id = "role-1";
    expect(
      convertEditorialV05({
        ...rawImport(source),
        personasJson: JSON.stringify(p),
      }).ok,
    ).toBe(false);
    source.questions.questions[0]!.options[0]!.effects = { missing: 2 };
    expect(
      convertEditorialV05({
        ...rawImport(source),
        questionsJson: JSON.stringify(source.questions),
      }).ok,
    ).toBe(false);
    const missing = syntheticEditorialV05();
    delete missing.families.family_mapping.Q01;
    expect(
      convertEditorialV05({
        ...rawImport(missing),
        familiesJson: JSON.stringify(missing.families),
      }).ok,
    ).toBe(false);
  });
});
