import { CONTENT_COMPONENTS_V3 } from "@/lib/assessment-contract/presentation-v3";
import { consumerComponentMappingV2Schema } from "@/lib/consumer-contract/v2/identities";

export const QIANZAI_CONSUMER_RENDERER = Object.freeze({
  id: "consumer-qianzai-tongxin",
  version: "1.2.0",
});
export const QIANZAI_PREVIEW_RENDERER = Object.freeze({
  id: "qianzai-tongxin-preview",
  version: "1.0.0",
});
export const QIANZAI_PREVIEW_PRESENTATION = Object.freeze({
  presentationMode: "authored-product" as const,
  exports: Object.freeze({ posterPng: false, fullReportPng: false }),
});
/** New consumers only. Existing sealed displays are never promoted on the client. */
export const QIANZAI_CONSUMER_PRESENTATION = Object.freeze({
  presentationMode: "authored-product" as const,
  exports: Object.freeze({ posterPng: true, fullReportPng: true }),
});
export const QIANZAI_COMPONENT_MAPPING = consumerComponentMappingV2Schema.parse(
  {
    schemaVersion: "quizforge.consumer-component-map.v2",
    states: Object.fromEntries(
      Object.entries(CONTENT_COMPONENTS_V3).map(([state, id]) => [
        state,
        {
          source: { id, version: "1.0.0", propsSchemaVersion: "1.0.0" },
          runtime: {
            id: `consumer-qianzai-${state}`,
            version: "1.0.0",
            propsSchemaVersion: "1.0.0",
          },
        },
      ]),
    ),
  },
);
for (const pair of Object.values(QIANZAI_COMPONENT_MAPPING.states)) {
  Object.freeze(pair.source);
  Object.freeze(pair.runtime);
  Object.freeze(pair);
}
Object.freeze(QIANZAI_COMPONENT_MAPPING.states);
Object.freeze(QIANZAI_COMPONENT_MAPPING);
