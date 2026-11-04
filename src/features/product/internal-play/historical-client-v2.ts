import { createElement, type ComponentType } from "react";
import type { ConsumerExperiencePropsV2 } from "@/features/theme/consumer-v2/interfaces";
import type { PersistedReportViewV2 } from "@/features/report/persisted/view-contracts-v2";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { consumerImplementationEntryV2Schema } from "./implementation-schema-v2";
import { consumerRendererIdentitySchema } from "@/lib/consumer-contract/v1/identities";
import v13Entry from "./implementation-data/consumer-qianzai-historical-v13.json";
import v14Entry from "./implementation-data/consumer-qianzai-historical-v14.json";
import { QIANZAI_RUNTIME_INPUTS as v13Inputs } from "@/features/theme/qianzai-tongxin/historical-v13/runtime-inputs";
import { QIANZAI_RUNTIME_INPUTS as v14Inputs } from "@/features/theme/qianzai-tongxin/historical-v14/runtime-inputs";
import { deriveQianzaiResultPresentation as v13Presentation } from "@/features/report/qianzai-tongxin/historical-v13/result-presentation";
import { deriveQianzaiResultPresentation as v14Presentation } from "@/features/report/qianzai-tongxin/historical-v14/result-presentation";
import { QianzaiHistoricalRuntime as V13 } from "@/features/theme/qianzai-tongxin/historical-v13/runtime";
import { QianzaiHistoricalRuntime as V14 } from "@/features/theme/qianzai-tongxin/historical-v14/runtime";

const sourceHashes = new Set([
  "dbe46ea379cb2201456d8d3640466fbcd7cb3c194fa9e7289b0130b755f6f4ee",
  "8cbcf2488308c4f4962e9e9ee0aacf79f0dce1a3fb386133b81a0561edff7c31",
]);
const mappingSha256 =
  "1242da7bb93821680e5743aa11f689693dcc3fd78e7c3c13d31222be8e5e6559";
const profiles = [
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
  });
});

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
    !["1.3.0", "1.4.0"].includes(view.renderer.version)
  )
    return undefined;
  if (!sourceHashes.has(view.display.canonicalContentSha256)) return null;
  const character = view.display.slots.character;
  if (
    !character ||
    !sameConsumerFact(character.resultRef, view.display.selectedResultRef, 8192)
  )
    return null;
  for (const profile of profiles) {
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
      !profile.derive(view, profile.presentationBinding)
    )
      continue;
    return Object.freeze({ descriptor: d, Experience: profile.Experience });
  }
  return null;
}
