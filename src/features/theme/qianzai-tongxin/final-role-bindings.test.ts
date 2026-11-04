import { beforeAll, describe, expect, it } from "vitest";
import baseline from "@/features/product/internal-versions/baselines/qztx-known-ten-experience-20261104.json";
import registration from "@/features/quizpack/content/private-test-registration-known-ten-experience.json";
import legacyBaseline from "@/features/product/internal-versions/baselines/qztx-final-private-20261103-demo.json";
import legacyRegistration from "@/features/quizpack/content/private-test-registration-final-demo.json";
import { qianzaiConsumerCopyFixture } from "@/features/report/qianzai-tongxin/consumer-copy.test-support";
import { QIANZAI_KNOWN_ROLE_DATA } from "@/features/report/qianzai-tongxin/known-role-data";
import { consumerComponentMappingV2Schema } from "@/lib/consumer-contract/v2/identities";
import { displayAssetV2Schema } from "@/lib/assessment-contract/display-v2";
import type { ConsumerV2ReaderModel } from "@/lib/consumer-contract/v2/client-contract";
import { resolveHistoricalReportRuntimeV2 } from "@/features/product/internal-play/historical-client-v2";
import v13Entry from "@/features/product/internal-play/implementation-data/consumer-qianzai-historical-v13.json";
import v14Entry from "@/features/product/internal-play/implementation-data/consumer-qianzai-historical-v14.json";
import { QIANZAI_RUNTIME_INPUTS as v13Inputs } from "./historical-v13/runtime-inputs";
import { QIANZAI_RUNTIME_INPUTS as v14Inputs } from "./historical-v14/runtime-inputs";
import { admittedQianzaiBindings as admitV13 } from "./historical-v13/resource-owner";
import { admittedQianzaiBindings as admitV14 } from "./historical-v14/resource-owner";
import { QIANZAI_RUNTIME_INPUTS } from "./runtime-inputs";
import { admittedQianzaiBindings } from "./resource-owner";

const uses = ["reveal", "report", "poster", "nameArt"] as const;
const characterSlots = [
  "character.nameArt",
  "character.poster",
  "character.report",
  "character.reveal",
];
type Display = NonNullable<ConsumerV2ReaderModel["report"]>["view"]["display"];
let base: Awaited<ReturnType<typeof qianzaiConsumerCopyFixture>>;
beforeAll(async () => {
  base = await qianzaiConsumerCopyFixture("li-bai");
});

/** Invented completed display selectors only. These declarations do not create
 * source admission, a persisted report or a resource grant and need no art bytes. */
function modelFor(
  character: NonNullable<Display["slots"]["character"]>,
  neutral: Display["slots"]["neutral"],
  resources: typeof registration.resources,
  source: string,
) {
  const model = structuredClone(base.model),
    display = model.report!.view.display;
  display.slots = {
    neutral: structuredClone(neutral),
    character: structuredClone(character),
  };
  display.selectedResultRef = { ...character.resultRef };
  display.body.matching.selected.ref = { ...character.resultRef };
  display.canonicalContentSha256 =
    display.body.provenance.canonicalContentSha256 = source;
  display.assets = resources.map(({ id, productId, version, ...facts }) =>
    displayAssetV2Schema.parse({
      ...facts,
      approval: "private-test-only",
      resourceRef: { id, productId, version },
      alt: id,
    }),
  );
  return model;
}

it("pairs the exact ten 3.0 roles with all53 registered resource facts", () => {
  expect(baseline.slots.characters).toHaveLength(10);
  expect(registration.resources).toHaveLength(53);
  expect(registration.canonicalContentSha256).toBe(
    baseline.canonicalContentSha256,
  );
  const actual = new Map(
    QIANZAI_RUNTIME_INPUTS.resources.map(({ asset }) => [
      JSON.stringify([
        asset.resourceRef.productId,
        asset.resourceRef.id,
        asset.resourceRef.version,
      ]),
      asset,
    ]),
  );
  expect(actual.size).toBe(53);
  for (const { id, productId, version, ...facts } of registration.resources) {
    expect(actual.get(JSON.stringify([productId, id, version]))).toEqual({
      ...facts,
      resourceRef: { id, productId, version },
      approval: "private-test-only",
    });
  }
});

it.each(baseline.slots.characters)(
  "admits exactly the four current 3.0 images for $resultRef.id",
  (character) => {
    const data = QIANZAI_KNOWN_ROLE_DATA.find(
      (r) => r.profile.ref.id === character.resultRef.id,
    )!;
    expect(character).toEqual({
      resultRef: data.profile.ref,
      ...data.resourceRefs,
    });
    expect(character.resultRef.version).toBe("3.0.0");
    const model = modelFor(
      character,
      baseline.slots.neutral,
      registration.resources,
      registration.canonicalContentSha256,
    );
    const images = admittedQianzaiBindings(
      model,
      QIANZAI_RUNTIME_INPUTS.resources,
    ).filter((b) => b.slot.startsWith("character."));
    expect(images.map((i) => i.slot).sort()).toEqual(characterSlots);
    expect(
      images.every((i) => i.layer === "clean" && i.resultRef === undefined),
    ).toBe(true);
    for (const use of uses)
      expect(
        images.find((i) => i.slot === `character.${use}`)!.asset.resourceRef,
      ).toEqual(character[use]);
  },
);

it.each(["sha", "version", "product"] as const)(
  "does not admit a current poster with mixed %s while keeping its other slots",
  (mixed) => {
    const character = baseline.slots.characters[0]!,
      model = modelFor(
        character,
        baseline.slots.neutral,
        registration.resources,
        registration.canonicalContentSha256,
      ),
      display = model.report!.view.display;
    if (mixed === "sha")
      display.assets.find(
        (a) => a.resourceRef.id === character.poster.id,
      )!.sha256 = "f".repeat(64);
    if (mixed === "version") display.slots.character!.poster.version = "2.0.0";
    if (mixed === "product")
      display.slots.character!.poster.productId = "other-product";
    const images = admittedQianzaiBindings(
      model,
      QIANZAI_RUNTIME_INPUTS.resources,
    ).filter((b) => b.slot.startsWith("character."));
    expect(images.map((i) => i.slot).sort()).toEqual(
      characterSlots.filter((slot) => slot !== "character.poster"),
    );
  },
);
it("does not give current character images to a different selected full ref", () => {
  const model = modelFor(
    baseline.slots.characters[0]!,
    baseline.slots.neutral,
    registration.resources,
    registration.canonicalContentSha256,
  );
  model.report!.view.display.selectedResultRef.version = "2.0.0";
  expect(
    admittedQianzaiBindings(model, QIANZAI_RUNTIME_INPUTS.resources).filter(
      (b) => b.slot.startsWith("character."),
    ),
  ).toEqual([]);
});

const historical = [
  { version: "1.3.0", entry: v13Entry, inputs: v13Inputs, admit: admitV13 },
  { version: "1.4.0", entry: v14Entry, inputs: v14Inputs, admit: admitV14 },
];
function historicalModel(
  profile: (typeof historical)[number],
  character: (typeof legacyBaseline.slots.characters)[number],
) {
  const model = modelFor(
      character,
      legacyBaseline.slots.neutral,
      legacyRegistration.resources,
      legacyRegistration.canonicalContentSha256,
    ),
    view = model.report!.view,
    d = profile.entry.descriptor;
  view.renderer = {
    kind: "consumer-renderer",
    id: d.id,
    version: d.version,
    entrySha256: profile.entry.entrySha256,
  };
  view.mapping = consumerComponentMappingV2Schema.parse(d.mapping);
  view.mappingSha256 = d.mappingSha256;
  view.font = {
    id: d.font.id,
    version: d.font.version,
    weight: 600,
    fileSha256: d.font.fileSha256,
    coverageSha256: d.font.coverageSha256,
    licenseSha256: d.font.licenseSha256,
  };
  return model;
}
describe.each(historical)("frozen $version reader", (profile) => {
  it.each(legacyBaseline.slots.characters)(
    "retains the five-role $resultRef.id four-slot admission and exact read-only adapter",
    (character) => {
      const model = historicalModel(profile, character),
        before = JSON.stringify(model.report),
        images = profile
          .admit(model, profile.inputs.resources)
          .filter((b) => b.slot.startsWith("character."));
      expect(images.map((i) => i.slot).sort()).toEqual(characterSlots);
      expect(
        images.every((i) => i.layer === "clean" && i.resultRef === undefined),
      ).toBe(true);
      for (const use of uses)
        expect(
          images.find((i) => i.slot === `character.${use}`)!.asset.resourceRef,
        ).toEqual(character[use]);
      expect(
        resolveHistoricalReportRuntimeV2(model.report!)?.descriptor.version,
      ).toBe(profile.version);
      expect(JSON.stringify(model.report)).toBe(before);
      expect(
        admittedQianzaiBindings(model, QIANZAI_RUNTIME_INPUTS.resources).filter(
          (b) => b.slot.startsWith("character."),
        ),
      ).toEqual([]);
    },
  );
  it("rejects mixed renderer SHA, source, role ref and asset facts in its historical adapter", () => {
    for (const mixed of [
      "renderer-sha",
      "source",
      "role-ref",
      "asset-sha",
    ] as const) {
      const model = historicalModel(
          profile,
          legacyBaseline.slots.characters[0]!,
        ),
        report = model.report!;
      if (mixed === "renderer-sha")
        report.view.renderer.entrySha256 = "f".repeat(64);
      if (mixed === "source")
        report.view.display.canonicalContentSha256 =
          registration.canonicalContentSha256;
      if (mixed === "role-ref")
        report.view.display.slots.character!.resultRef.version = "3.0.0";
      if (mixed === "asset-sha")
        report.view.display.assets.find(
          (a) =>
            a.resourceRef.id === report.view.display.slots.character!.poster.id,
        )!.sha256 = "f".repeat(64);
      expect(resolveHistoricalReportRuntimeV2(report), mixed).toBeNull();
    }
  });
});
