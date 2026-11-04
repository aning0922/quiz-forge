import { createElement, type ComponentType } from "react";
import type { ConsumerExperiencePropsV2 } from "@/features/theme/consumer-v2/interfaces";
import type { PersistedReportViewV2 } from "@/features/report/persisted/view-contracts-v2";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { consumerImplementationEntryV2Schema } from "./implementation-schema-v2";
import { consumerRendererIdentitySchema } from "@/lib/consumer-contract/v1/identities";
import v13Entry from "./implementation-data/consumer-qianzai-historical-v13.json";
import v14Entry from "./implementation-data/consumer-qianzai-historical-v14.json";
import v15Entry from "./implementation-data/consumer-qianzai-historical-v15.json";
import v151Entry from "./implementation-data/consumer-qianzai-historical-v151.json";
import v152Entry from "./implementation-data/consumer-qianzai-historical-v152.json";
import { QIANZAI_RUNTIME_INPUTS as v13Inputs } from "@/features/theme/qianzai-tongxin/historical-v13/runtime-inputs";
import { QIANZAI_RUNTIME_INPUTS as v14Inputs } from "@/features/theme/qianzai-tongxin/historical-v14/runtime-inputs";
import { QIANZAI_RUNTIME_INPUTS as v15Inputs } from "@/features/theme/qianzai-tongxin/historical-v15/runtime-inputs";
import { QIANZAI_RUNTIME_INPUTS as v151Inputs } from "@/features/theme/qianzai-tongxin/historical-v151/runtime-inputs";
import { QIANZAI_RUNTIME_INPUTS as v152Inputs } from "@/features/theme/qianzai-tongxin/historical-v152/runtime-inputs";
import { deriveQianzaiResultPresentation as v13Presentation } from "@/features/report/qianzai-tongxin/historical-v13/result-presentation";
import { deriveQianzaiResultPresentation as v14Presentation } from "@/features/report/qianzai-tongxin/historical-v14/result-presentation";
import { deriveQianzaiResultPresentation as v15Presentation } from "@/features/report/qianzai-tongxin/historical-v15/result-presentation";
import { deriveQianzaiResultPresentation as v151Presentation } from "@/features/report/qianzai-tongxin/historical-v151/result-presentation";
import { deriveQianzaiResultPresentation as v152Presentation } from "@/features/report/qianzai-tongxin/historical-v152/result-presentation";
import { QianzaiHistoricalRuntime as V13 } from "@/features/theme/qianzai-tongxin/historical-v13/runtime";
import { QianzaiHistoricalRuntime as V14 } from "@/features/theme/qianzai-tongxin/historical-v14/runtime";
import { QianzaiHistoricalRuntime as V15 } from "@/features/theme/qianzai-tongxin/historical-v15/runtime";
import { QianzaiHistoricalRuntime as V151 } from "@/features/theme/qianzai-tongxin/historical-v151/runtime";
import { QianzaiHistoricalRuntime as V152 } from "@/features/theme/qianzai-tongxin/historical-v152/runtime";

const sourceHashes = new Set([
  "dbe46ea379cb2201456d8d3640466fbcd7cb3c194fa9e7289b0130b755f6f4ee",
  "8cbcf2488308c4f4962e9e9ee0aacf79f0dce1a3fb386133b81a0561edff7c31",
]);
const mappingSha256 =
  "1242da7bb93821680e5743aa11f689693dcc3fd78e7c3c13d31222be8e5e6559";
const legacyProfiles = [
  { entry: v13Entry, inputs: v13Inputs, derive: v13Presentation, Runtime: V13 },
  { entry: v14Entry, inputs: v14Inputs, derive: v14Presentation, Runtime: V14 },
].map(({ entry: raw, inputs, derive, Runtime }) => {
  const entry = consumerImplementationEntryV2Schema.parse(raw);
  const identity = Object.freeze(
    consumerRendererIdentitySchema.parse({
      kind: entry.descriptor.kind,
      id: entry.descriptor.id,
      version: entry.descriptor.version,
      entrySha256: entry.entrySha256,
    }),
  );
  const presentationBinding = Object.freeze({
    renderer: identity,
    profileVersion: "qianzai-role-presentation.v1.1" as const,
  });
  const Experience: ComponentType<ConsumerExperiencePropsV2> = (props) =>
    createElement(Runtime, { ...props, presentationBinding });
  return Object.freeze({
    entry,
    identity,
    inputs,
    derive,
    presentationBinding,
    Experience,
    sources: sourceHashes,
    presentationMatches: (view: PersistedReportViewV2["view"]) =>
      Boolean(derive(view, presentationBinding)),
  });
});

const v15 = consumerImplementationEntryV2Schema.parse(v15Entry);
const v15Identity = consumerRendererIdentitySchema.parse({
  kind: v15.descriptor.kind,
  id: v15.descriptor.id,
  version: v15.descriptor.version,
  entrySha256: v15.entrySha256,
});
const v15Binding = Object.freeze({
  renderer: v15Identity,
  profileVersion: "qianzai-role-presentation.v2" as const,
  canonicalContentSha256:
    "6c701d4445f98b2d6e042dde1edc203e118c9a79728697ef551fa89fe2bd2187",
});
const V15Experience: ComponentType<ConsumerExperiencePropsV2> = (props) =>
  createElement(V15, { ...props, presentationBinding: v15Binding });
const v151 = consumerImplementationEntryV2Schema.parse(v151Entry);
const v151Identity = consumerRendererIdentitySchema.parse({
  kind: v151.descriptor.kind,
  id: v151.descriptor.id,
  version: v151.descriptor.version,
  entrySha256: v151.entrySha256,
});
const v151Binding = Object.freeze({
  renderer: v151Identity,
  profileVersion: "qianzai-role-presentation.v2" as const,
  canonicalContentSha256:
    "6c701d4445f98b2d6e042dde1edc203e118c9a79728697ef551fa89fe2bd2187",
});
const V151Experience: ComponentType<ConsumerExperiencePropsV2> = (props) =>
  createElement(V151, { ...props, presentationBinding: v151Binding });
const v152 = consumerImplementationEntryV2Schema.parse(v152Entry);
const v152Identity = consumerRendererIdentitySchema.parse({
  kind: v152.descriptor.kind,
  id: v152.descriptor.id,
  version: v152.descriptor.version,
  entrySha256: v152.entrySha256,
});
const v152Binding = Object.freeze({
  renderer: v152Identity,
  profileVersion: "qianzai-role-presentation.v2" as const,
  canonicalContentSha256:
    "6c701d4445f98b2d6e042dde1edc203e118c9a79728697ef551fa89fe2bd2187",
});
const V152Experience: ComponentType<ConsumerExperiencePropsV2> = (props) =>
  createElement(V152, { ...props, presentationBinding: v152Binding });
const profiles = [
  ...legacyProfiles,
  Object.freeze({
    entry: v15,
    identity: v15Identity,
    inputs: v15Inputs,
    Experience: V15Experience,
    sources: new Set<string>([v15Binding.canonicalContentSha256]),
    presentationMatches: (view: PersistedReportViewV2["view"]) =>
      Boolean(v15Presentation(view, v15Binding)),
  }),
  Object.freeze({
    entry: v151,
    identity: v151Identity,
    inputs: v151Inputs,
    Experience: V151Experience,
    sources: new Set<string>([v151Binding.canonicalContentSha256]),
    presentationMatches: (view: PersistedReportViewV2["view"]) =>
      Boolean(v151Presentation(view, v151Binding)),
  }),
  Object.freeze({
    entry: v152,
    identity: v152Identity,
    inputs: v152Inputs,
    Experience: V152Experience,
    sources: new Set<string>([v152Binding.canonicalContentSha256]),
    presentationMatches: (view: PersistedReportViewV2["view"]) =>
      Boolean(v152Presentation(view, v152Binding)),
  }),
];

/** Only the controller's verified immutable report reaches this presentation selector.
 * The server still verifies snapshot/receipt/grant/resource authority. This never
 * participates in entry projection, current availability, scoring or completion.
 */
export function resolveHistoricalReportRuntimeV2(
  report: PersistedReportViewV2,
) {
  const view = report.view;
  // Undefined delegates unrelated editions; null rejects an old identity without fallback.
  if (
    view.renderer.id !== "consumer-qianzai-tongxin" ||
    !["1.3.0", "1.4.0", "1.5.0", "1.5.1", "1.5.2"].includes(
      view.renderer.version,
    )
  )
    return undefined;
  const character = view.display.slots.character;
  if (
    !character ||
    !sameConsumerFact(character.resultRef, view.display.selectedResultRef, 8192)
  )
    return null;
  for (const profile of profiles) {
    if (!profile.sources.has(view.display.canonicalContentSha256)) continue;
    const d = profile.entry.descriptor;
    if ("kind" in d.font) continue;
    const font = {
      id: d.font.id,
      version: d.font.version,
      weight: d.font.weight,
      fileSha256: d.font.fileSha256,
      coverageSha256: d.font.coverageSha256,
      licenseSha256: d.font.licenseSha256,
    };
    if (
      !sameConsumerFact(view.renderer, profile.identity, 8192) ||
      !sameConsumerFact(view.mapping, d.mapping, 8192) ||
      view.mappingSha256 !== mappingSha256 ||
      !sameConsumerFact(view.font, font, 8192) ||
      !sameConsumerFact(view.display.exports, d.exports, 8192) ||
      view.display.presentationMode !== d.presentationMode ||
      view.display.assets.some(({ alt, ...asset }) => {
        void alt;
        return !profile.inputs.resources.some((binding) =>
          sameConsumerFact(binding.asset, asset, 8192),
        );
      }) ||
      (["reveal", "report", "poster", "nameArt"] as const).some(
        (use) =>
          !profile.inputs.resources.some(
            (binding) =>
              binding.slot === `character.${use}` &&
              binding.layer === "clean" &&
              sameConsumerFact(binding.asset.resourceRef, character[use], 8192),
          ),
      ) ||
      !profile.presentationMatches(view)
    )
      continue;
    return Object.freeze({ descriptor: d, Experience: profile.Experience });
  }
  return null;
}
