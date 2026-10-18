import {
  consumerComponentMappingSchema,
  type ConsumerComponentMapping,
} from "@/lib/consumer-contract/v1/identities";
import { DISPLAY_COMPONENT_IDS_V1 } from "@/lib/assessment-contract/display-limits-v1";
import { CONSUMER_COMPONENTS_V1 } from "./components";

export const CONSUMER_RENDERER_V1 = Object.freeze({
  id: "consumer-folio-cabinet",
  version: "1.0.0",
});
const pair = (
  sourceId: string,
  runtimeId: keyof typeof CONSUMER_COMPONENTS_V1,
) =>
  Object.freeze({
    source: Object.freeze({
      id: sourceId,
      version: "2.0.0",
      propsSchemaVersion: "1.0.0",
    }),
    runtime: Object.freeze({
      id: runtimeId,
      version: "1.0.0",
      propsSchemaVersion: "1.0.0",
    }),
  });
/** Compiled fixed table. Descriptor registration and its entry SHA remain root-owned. */
export const CONSUMER_COMPONENT_MAPPING_V1 = Object.freeze({
  schemaVersion: "quizforge.consumer-component-map.v1" as const,
  states: Object.freeze({
    cover: pair(DISPLAY_COMPONENT_IDS_V1.cover, "consumer-folio-cover"),
    question: pair(
      DISPLAY_COMPONENT_IDS_V1.question,
      "consumer-folio-question",
    ),
    resume: pair(DISPLAY_COMPONENT_IDS_V1.resume, "consumer-folio-resume"),
    result: pair(DISPLAY_COMPONENT_IDS_V1.result, "consumer-cabinet-result"),
    report: pair(DISPLAY_COMPONENT_IDS_V1.report, "consumer-folio-report"),
    poster: pair(DISPLAY_COMPONENT_IDS_V1.poster, "consumer-folio-poster"),
  }),
});
export function matchesConsumerMappingV1(input: unknown): boolean {
  const parsed = consumerComponentMappingSchema.safeParse(input);
  if (!parsed.success) return false;
  return (
    Object.keys(
      CONSUMER_COMPONENT_MAPPING_V1.states,
    ) as (keyof ConsumerComponentMapping["states"])[]
  ).every((state) => {
    const actual = parsed.data.states[state],
      fixed = CONSUMER_COMPONENT_MAPPING_V1.states[state];
    return (
      actual.source.id === fixed.source.id &&
      actual.source.version === fixed.source.version &&
      actual.source.propsSchemaVersion === fixed.source.propsSchemaVersion &&
      actual.runtime.id === fixed.runtime.id &&
      actual.runtime.version === fixed.runtime.version &&
      actual.runtime.propsSchemaVersion === fixed.runtime.propsSchemaVersion
    );
  });
}
/** No component default/latest lookup; caller first resolves the exact registered renderer identity. */
export function bindConsumerComponentsV1(mapping: unknown) {
  return matchesConsumerMappingV1(mapping) ? CONSUMER_COMPONENTS_V1 : null;
}
