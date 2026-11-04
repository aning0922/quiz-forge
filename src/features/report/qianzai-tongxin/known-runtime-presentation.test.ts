import { beforeAll, expect, it } from "vitest";
import { qianzaiConsumerCopyFixture } from "./consumer-copy.test-support";
import { QIANZAI_KNOWN_ROLE_DATA } from "./known-role-data";
import { QIANZAI_CLASSICAL_EDITION } from "./classical-edition";
import { deriveQianzaiResultPresentation } from "./result-presentation";
import { qianzaiSnapshotDocument } from "./presentation";
import artRules from "@/features/theme/qianzai-tongxin/known-art-presentation.json";
import { knownQianzaiArtPresentation } from "@/features/theme/qianzai-tongxin/known-art-presentation";
import { displayAssetV2Schema } from "@/lib/assessment-contract/display-v2";
import {
  QIANZAI_KNOWN_PRESENTATION_SOURCE_SHA256,
  QIANZAI_KNOWN_SHARED_TEMPLATE_REF,
} from "./known-presentation-source";

let base: Awaited<ReturnType<typeof qianzaiConsumerCopyFixture>>;
beforeAll(async () => {
  base = await qianzaiConsumerCopyFixture("li-bai");
});

/** Synthetic sealed-shape display inputs only, not source admission or persisted reports. */
function fixture(id: string) {
  const f = structuredClone(base),
    data = QIANZAI_KNOWN_ROLE_DATA.find((r) => r.profile.ref.id === id)!;
  f.view.renderer = { ...f.view.renderer, version: "1.5.0" };
  f.body.matching.selected.ref = f.view.display.selectedResultRef = {
    ...data.profile.ref,
  };
  f.view.display.canonicalContentSha256 =
    f.body.provenance.canonicalContentSha256 =
      QIANZAI_KNOWN_PRESENTATION_SOURCE_SHA256;
  f.view.display.contentVersion = "3.0.0";
  f.view.display.reportVersion = f.body.provenance.reportVersion = "2.0.0";
  f.view.display.reportTemplateRef = { ...QIANZAI_KNOWN_SHARED_TEMPLATE_REF };
  f.body.provenance.templateRef = { ...QIANZAI_KNOWN_SHARED_TEMPLATE_REF };
  const binding = {
    renderer: f.view.renderer,
    profileVersion: QIANZAI_CLASSICAL_EDITION.presentationVersion,
    canonicalContentSha256: f.view.display.canonicalContentSha256,
  };
  return { ...f, binding, data };
}

it.each(QIANZAI_KNOWN_ROLE_DATA.map((r) => r.profile.ref.id))(
  "builds %s v2/v3 prose from its fixed data and original evidence without mutating the body",
  (id) => {
    const f = fixture(id),
      before = JSON.stringify(f.body);
    const result = deriveQianzaiResultPresentation(f.view, f.binding)!;
    expect(result).not.toBeNull();
    expect(result.role).toEqual(f.data.profile);
    expect(result.profileVersion).toBe(
      QIANZAI_CLASSICAL_EDITION.presentationVersion,
    );
    const doc = qianzaiSnapshotDocument(f.body, undefined, result);
    expect(doc.consumerCopyVersion).toBe(QIANZAI_CLASSICAL_EDITION.copyVersion);
    expect(doc.name).toBe(f.data.profile.displayName);
    expect(doc.sections).toHaveLength(6);
    const text = doc.sections
      .flatMap((s) => s.blocks.map((b) => b.text))
      .join("\n");
    expect(text).not.toContain("RAW_INTERNAL");
    expect(text).toContain(f.data.profile.history.timeline[0]!.text);
    expect(text).toContain(f.data.copy.closing[2]);
    expect(JSON.stringify(f.body)).toBe(before);
  },
);

it("requires the new exact renderer/source binding and current full role ref", () => {
  const mutations = [
    (f: ReturnType<typeof fixture>) => {
      f.binding.canonicalContentSha256 = "f".repeat(64);
    },
    (f: ReturnType<typeof fixture>) => {
      f.view.renderer = { ...f.view.renderer, entrySha256: "f".repeat(64) };
    },
    (f: ReturnType<typeof fixture>) => {
      f.view.renderer.version = "1.4.0";
    },
    (f: ReturnType<typeof fixture>) => {
      f.body.matching.selected.ref.version = "2.0.0";
    },
    (f: ReturnType<typeof fixture>) => {
      f.body.provenance.reportVersion = "1.0.0";
    },
  ];
  for (const mutate of mutations) {
    const f = fixture("wu-zetian");
    mutate(f);
    expect(deriveQianzaiResultPresentation(f.view, f.binding)).toBeNull();
  }
});

it("pins ten native scene framings and only the inspected ink-name gold treatment to complete asset facts", () => {
  for (const row of artRules.rows) {
    const f = fixture(row.resultRef.id);
    const result = deriveQianzaiResultPresentation(f.view, f.binding)!;
    const asset = displayAssetV2Schema.parse({
      ...row.asset,
      alt: "合成取景选择器",
    });
    expect(
      knownQianzaiArtPresentation(
        result,
        asset,
        row.use as "reveal" | "nameArt",
      ),
    ).toBe(row.use === "reveal" ? "native-width-scene" : "gold-alpha");
    expect(
      knownQianzaiArtPresentation(
        result,
        { ...asset, resourceRef: { ...asset.resourceRef, version: "2.0.0" } },
        row.use as "reveal" | "nameArt",
      ),
    ).toBeUndefined();
    expect(
      knownQianzaiArtPresentation(
        result,
        { ...asset, sha256: "f".repeat(64) },
        row.use as "reveal" | "nameArt",
      ),
    ).toBeUndefined();
  }
  const row = artRules.rows.find((row) => row.use === "nameArt")!;
  const f = fixture("su-shi"),
    result = deriveQianzaiResultPresentation(f.view, f.binding)!;
  expect(
    knownQianzaiArtPresentation(
      result,
      displayAssetV2Schema.parse({ ...row.asset, alt: "合成跨角色" }),
      "nameArt",
    ),
  ).toBeUndefined();
});
