import { beforeAll, expect, it } from "vitest";
import { qianzaiPresentationFixture } from "@/features/report/qianzai-tongxin/result-presentation.test-support";
import { QIANZAI_RUNTIME_INPUTS as v13Inputs } from "@/features/theme/qianzai-tongxin/historical-v13/runtime-inputs";
import { QIANZAI_RUNTIME_INPUTS as v14Inputs } from "@/features/theme/qianzai-tongxin/historical-v14/runtime-inputs";
import { QIANZAI_RUNTIME_INPUTS as v15Inputs } from "@/features/theme/qianzai-tongxin/historical-v15/runtime-inputs";
import v13 from "./implementation-data/consumer-qianzai-historical-v13.json";
import v14 from "./implementation-data/consumer-qianzai-historical-v14.json";
import v15 from "./implementation-data/consumer-qianzai-historical-v15.json";
import { qianzaiConsumerCopyFixture } from "@/features/report/qianzai-tongxin/consumer-copy.test-support";
import { QIANZAI_KNOWN_ROLE_DATA } from "@/features/report/qianzai-tongxin/historical-v15/known-role-data";
import { QIANZAI_KNOWN_SHARED_TEMPLATE_REF } from "@/features/report/qianzai-tongxin/historical-v15/known-presentation-source";
import { resolveHistoricalReportRuntimeV2 } from "./historical-client-v2";
import type { PersistedReportViewV2 } from "@/features/report/persisted/view-contracts-v2";
import { consumerComponentMappingV2Schema } from "@/lib/consumer-contract/v2/identities";

let base: Awaited<ReturnType<typeof qianzaiPresentationFixture>>;
let tenBase: Awaited<ReturnType<typeof qianzaiConsumerCopyFixture>>;
beforeAll(async () => {
  base = await qianzaiPresentationFixture();
  tenBase = await qianzaiConsumerCopyFixture("li-bai");
});

function v15Fixture() {
  const f = structuredClone(tenBase),
    d = v15.descriptor;
  const role = QIANZAI_KNOWN_ROLE_DATA.find(
    (r) => r.profile.ref.id === "li-bai",
  )!.profile.ref;
  f.view.renderer = {
    kind: "consumer-renderer",
    id: d.id,
    version: d.version,
    entrySha256: v15.entrySha256,
  };
  f.view.mapping = consumerComponentMappingV2Schema.parse(d.mapping);
  f.view.mappingSha256 =
    "1242da7bb93821680e5743aa11f689693dcc3fd78e7c3c13d31222be8e5e6559";
  f.view.font = {
    id: d.font.id,
    version: d.font.version,
    weight: 600,
    fileSha256: d.font.fileSha256,
    coverageSha256: d.font.coverageSha256,
    licenseSha256: d.font.licenseSha256,
  };
  f.view.display.canonicalContentSha256 =
    f.body.provenance.canonicalContentSha256 =
      "6c701d4445f98b2d6e042dde1edc203e118c9a79728697ef551fa89fe2bd2187";
  f.view.display.selectedResultRef = f.body.matching.selected.ref = { ...role };
  f.view.display.contentVersion = "3.0.0";
  f.view.display.reportVersion = f.body.provenance.reportVersion = "2.0.0";
  f.view.display.reportTemplateRef = f.body.provenance.templateRef = {
    ...QIANZAI_KNOWN_SHARED_TEMPLATE_REF,
  };
  f.view.display.presentationMode = "authored-product";
  f.view.display.exports = { posterPng: true, fullReportPng: true };
  const character = {
    resultRef: role,
    reveal: role,
    report: role,
    poster: role,
    nameArt: role,
  };
  const assets = [];
  for (const use of ["reveal", "report", "poster", "nameArt"] as const) {
    const binding = v15Inputs.resources.find(
      (b) =>
        b.slot === `character.${use}` &&
        b.asset.resourceRef.id.includes("li-bai"),
    )!;
    character[use] = { ...binding.asset.resourceRef };
    assets.push({ ...binding.asset, alt: `合成只读-${use}` });
  }
  f.view.display.slots.character = character;
  f.view.display.assets = assets;
  return {
    receipt: f.model.report!.receipt,
    view: f.view,
  } satisfies PersistedReportViewV2;
}

it("keeps the exact 1.5 report on its frozen read-only profile without mutating facts", () => {
  const report = v15Fixture(),
    before = JSON.stringify(report);
  const runtime = resolveHistoricalReportRuntimeV2(report);
  expect(runtime?.descriptor.version).toBe("1.5.0");
  expect(Object.keys(runtime!).sort()).toEqual(["Experience", "descriptor"]);
  expect(JSON.stringify(report)).toBe(before);
});

it.each(["renderer", "mapping", "font", "asset", "slot", "source"] as const)(
  "rejects a mixed 1.5 historical %s without falling back to current",
  (fact) => {
    const report = v15Fixture();
    if (fact === "renderer") report.view.renderer.entrySha256 = "f".repeat(64);
    if (fact === "mapping")
      report.view.mapping.states.report.runtime.version = "9.0.0";
    if (fact === "font") {
      if ("kind" in report.view.font) throw Error("FIXTURE_FONT_INVALID");
      report.view.font.fileSha256 = "f".repeat(64);
    }
    if (fact === "asset")
      report.view.display.assets[0]!.sha256 = "f".repeat(64);
    if (fact === "slot")
      report.view.display.slots.character!.poster.version = "2.0.0";
    if (fact === "source")
      report.view.display.canonicalContentSha256 =
        "8cbcf2488308c4f4962e9e9ee0aacf79f0dce1a3fb386133b81a0561edff7c31";
    expect(resolveHistoricalReportRuntimeV2(report)).toBeNull();
  },
);

it("delegates the new patch version to current selection without promoting a sealed 1.5 report", () => {
  const report = v15Fixture();
  report.view.renderer.version = "1.5.1";
  expect(resolveHistoricalReportRuntimeV2(report)).toBeUndefined();
});

/** Synthetic display-selector props only. Placeholder receipt/body hashes are
 * deliberately not presented as a verified persisted report or resource grant. */
function fixture(version: "v13" | "v14") {
  const f = structuredClone(base);
  const entry = version === "v13" ? v13 : v14;
  const inputs = version === "v13" ? v13Inputs : v14Inputs;
  const d = entry.descriptor;
  f.view.renderer = {
    kind: "consumer-renderer",
    id: d.id,
    version: d.version,
    entrySha256: entry.entrySha256,
  };
  f.view.mapping = consumerComponentMappingV2Schema.parse(d.mapping);
  f.view.mappingSha256 =
    "1242da7bb93821680e5743aa11f689693dcc3fd78e7c3c13d31222be8e5e6559";
  f.view.font = {
    id: d.font.id,
    version: d.font.version,
    weight: 600,
    fileSha256: d.font.fileSha256,
    coverageSha256: d.font.coverageSha256,
    licenseSha256: d.font.licenseSha256,
  };
  f.view.display.canonicalContentSha256 =
    f.view.display.body.provenance.canonicalContentSha256 =
      "8cbcf2488308c4f4962e9e9ee0aacf79f0dce1a3fb386133b81a0561edff7c31";
  f.view.display.presentationMode = "authored-product";
  f.view.display.exports = { posterPng: true, fullReportPng: true };
  const resultRef = f.view.display.selectedResultRef;
  const character = {
    resultRef,
    reveal: resultRef,
    report: resultRef,
    poster: resultRef,
    nameArt: resultRef,
  };
  const assets = [];
  for (const use of ["reveal", "report", "poster", "nameArt"] as const) {
    const binding = inputs.resources.find(
      (b) => b.slot === `character.${use}` && b.layer === "clean",
    )!;
    character[use] = structuredClone(binding.asset.resourceRef);
    assets.push({ ...binding.asset, alt: `合成选择器-${use}` });
  }
  f.view.display.slots.character = character;
  f.view.display.assets = assets;
  return {
    receipt: f.model.report!.receipt,
    view: f.view,
  } satisfies PersistedReportViewV2;
}

it.each(["v13", "v14"] as const)(
  "selects only its exact %s read-only profile without changing any report facts",
  (version) => {
    const report = fixture(version),
      before = JSON.stringify(report);
    const runtime = resolveHistoricalReportRuntimeV2(report);
    expect(runtime).not.toBeNull();
    expect(runtime!.descriptor.version).toBe(
      version === "v13" ? "1.3.0" : "1.4.0",
    );
    expect(Object.keys(runtime!).sort()).toEqual(["Experience", "descriptor"]);
    expect(JSON.stringify(report)).toBe(before);
  },
);

it.each(["renderer", "mapping", "font", "resource", "slot", "source"] as const)(
  "rejects mixed historical %s instead of choosing the new runtime",
  (fact) => {
    const report = fixture("v13");
    if (fact === "renderer") report.view.renderer.entrySha256 = "f".repeat(64);
    if (fact === "mapping")
      report.view.mapping.states.report.runtime.version = "9.0.0";
    if (fact === "font") report.view.font = fixture("v14").view.font;
    if (fact === "resource")
      report.view.display.assets[0]!.sha256 = "f".repeat(64);
    if (fact === "slot")
      report.view.display.slots.character!.poster.version = "3.0.0";
    if (fact === "source")
      report.view.display.canonicalContentSha256 = "f".repeat(64);
    expect(resolveHistoricalReportRuntimeV2(report)).toBeNull();
  },
);
