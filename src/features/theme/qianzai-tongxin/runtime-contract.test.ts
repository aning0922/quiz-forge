import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { syntheticContentV3 } from "@/features/quizpack/content/v3-fixtures.test-support";
import { quizPackContentV3Schema } from "@/features/quizpack/content/v3";
import { validateContentV3 } from "@/features/quizpack/content/v3-references";
import { prepareContentV3 } from "@/features/quizpack/content/v3-scoring-adapter";
import { syntheticInputV2 } from "@/features/quiz/scoring/v2/fixtures.test-support";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import {
  projectContentEntryV3,
  projectPreparedResultV3,
} from "../preview/v3-projection";
import { resultDisplaySnapshotV2Schema } from "@/lib/assessment-contract/display-v2";
import { projectQianzaiEntry, projectQianzaiResult } from "./projection";
import { preferenceMigration } from "../../../../scripts/build-qztx-preference-migration";
const hash = (v: unknown) =>
  createHash("sha256").update(canonicalP1Json(v)).digest("hex");
const withPreference = () => {
  const c = syntheticContentV3();
  c.bindings.slots.neutral.preferenceScene =
    c.bindings.slots.neutral.acts[0]!.background;
  c.bindings.layouts.cover.resourceRefs.push(
    c.bindings.slots.neutral.preferenceScene,
  );
  return c;
};
describe("additive preference slot and fixed authored projection", () => {
  it("does not materialize an absent slot or change old canonical content/result bytes", () => {
    const c = syntheticContentV3(),
      text = canonicalP1Json(c),
      parsed = quizPackContentV3Schema.parse(c);
    expect(canonicalP1Json(parsed)).toBe(text);
    expect(
      Object.hasOwn(parsed.bindings.slots.neutral, "preferenceScene"),
    ).toBe(false);
    expect(projectContentEntryV3(c, hash(c)).ok).toBe(true);
    const p = prepareContentV3(c);
    if (!p.ok) throw Error("FIXTURE");
    const r = projectPreparedResultV3(
      p.value,
      syntheticInputV2(3, [2, 2, 2], "female"),
    );
    if (!r.ok) throw Error("FIXTURE");
    expect(
      canonicalP1Json(resultDisplaySnapshotV2Schema.parse(r.value.display)),
    ).toBe(canonicalP1Json(r.value.display));
    expect(projectQianzaiEntry(c, hash(c)).ok).toBe(false);
  });
  it("includes the explicit preference ref in entry/result while preserving scoring logic", () => {
    const old = syntheticContentV3(),
      c = withPreference();
    expect(validateContentV3(c).ok).toBe(true);
    const projected = projectQianzaiEntry(c, hash(c));
    if (!projected.ok) throw Error("FIXTURE");
    expect(projected.value).toMatchObject({
      presentationMode: "authored-product",
      exports: { posterPng: false, fullReportPng: false },
      slots: { preferenceScene: c.bindings.slots.neutral.preferenceScene },
    });
    const p = prepareContentV3(c),
      o = prepareContentV3(old);
    if (!p.ok || !o.ok) throw Error("FIXTURE");
    const input = syntheticInputV2(3, [2, 2, 2], "female");
    const result = projectQianzaiResult(p.value, input),
      before = projectPreparedResultV3(o.value, input);
    if (!result.ok || !before.ok) throw Error("FIXTURE");
    expect(result.value.display.slots.neutral.preferenceScene).toEqual(
      c.bindings.slots.neutral.preferenceScene,
    );
    expect(result.value.score.score.logicHash).toBe(
      before.value.score.score.logicHash,
    );
    expect(result.value.score.score.decision).toEqual(
      before.value.score.score.decision,
    );
    expect(result.value.score.canonicalContentSha256).not.toBe(
      before.value.score.canonicalContentSha256,
    );
  });
  it("rejects missing, cross-product, portrait or unlisted preference resources", () => {
    for (const ref of [
      {
        ...withPreference().bindings.slots.neutral.preferenceScene!,
        productId: "other-product",
      },
      {
        ...withPreference().bindings.slots.neutral.preferenceScene!,
        id: "unlisted-scene",
      },
      withPreference().bindings.slots.characters[0]!.reveal,
      withPreference().bindings.slots.neutral.cover,
    ]) {
      const c = withPreference();
      c.bindings.slots.neutral.preferenceScene = ref;
      expect(validateContentV3(c).ok).toBe(false);
    }
    const c = withPreference();
    c.bindings.layouts.cover.resourceRefs.pop();
    expect(validateContentV3(c).ok).toBe(false);
  });
  it("generates only the optional SQL schema addition and conditional asset extraction", async () => {
    const old = await readFile(
      "migrations/p2a/0024_matching_context_composed_reports.sql",
      "utf8",
    );
    const sql = preferenceMigration(old);
    expect(sql).toBe(
      await readFile("migrations/p2a/0025_preference_scene_slot.sql", "utf8"),
    );
    const schemas = (s: string) =>
      [
        ...s.matchAll(
          /WHEN '([^']+)' THEN \$qztx_schema\$([^]*?)\$qztx_schema\$/g,
        ),
      ].map((m) => [m[1], JSON.parse(m[2]!)]) as [string, unknown][];
    let removed = 0;
    const omit = (n: unknown) => {
      if (!n || typeof n !== "object") return;
      const r = n as Record<string, unknown>;
      const p = r.properties as Record<string, unknown> | undefined;
      if (p && Object.hasOwn(p, "preferenceScene")) {
        expect(r.required).not.toContain("preferenceScene");
        delete p.preferenceScene;
        removed++;
      }
      Object.values(r).forEach(omit);
    };
    const next = schemas(sql);
    next.forEach(([, s]) => omit(s));
    expect(removed).toBe(2);
    expect(next).toEqual(schemas(old));
    expect(sql).toContain("IF neutral ? 'preferenceScene' THEN");
    expect(sql).toContain("D3_UNSETTLED_IO");
    expect(sql).toContain("D3_PREVIOUS_HELPER_CHANGED");
    expect(sql).not.toMatch(/^\s*(UPDATE|INSERT|DELETE|ALTER TABLE)\b/m);
  });
});
