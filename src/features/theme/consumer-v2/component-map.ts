import {
  consumerComponentMappingV2Schema,
  type ConsumerComponentMappingV2,
} from "@/lib/consumer-contract/v2/identities";
import {
  CONTENT_COMPONENTS_V3,
  CONTENT_COMPONENT_VERSION_V3,
} from "@/lib/assessment-contract/presentation-v3";

type RuntimeId = keyof typeof import("./components").CONSUMER_COMPONENTS_V2;
export const CONSUMER_RENDERER_V2 = Object.freeze({
  id: "consumer-structured-composed",
  version: "1.0.0",
});
const pair = (sourceId: string, runtimeId: RuntimeId) =>
  Object.freeze({
    source: Object.freeze({
      id: sourceId,
      version: CONTENT_COMPONENT_VERSION_V3,
      propsSchemaVersion: "1.0.0" as const,
    }),
    runtime: Object.freeze({
      id: runtimeId,
      version: "1.0.0",
      propsSchemaVersion: "1.0.0" as const,
    }),
  });
/** Root owns descriptor registration and entry SHA; this table has no catalog dependency. */
export const CONSUMER_COMPONENT_MAPPING_V2 = Object.freeze({
  schemaVersion: "quizforge.consumer-component-map.v2" as const,
  states: Object.freeze({
    cover: pair(CONTENT_COMPONENTS_V3.cover, "consumer-structured-cover"),
    question: pair(
      CONTENT_COMPONENTS_V3.question,
      "consumer-structured-question",
    ),
    resume: pair(CONTENT_COMPONENTS_V3.resume, "consumer-structured-resume"),
    result: pair(CONTENT_COMPONENTS_V3.result, "consumer-structured-result"),
    report: pair(CONTENT_COMPONENTS_V3.report, "consumer-structured-report"),
    poster: pair(CONTENT_COMPONENTS_V3.poster, "consumer-structured-poster"),
  }),
});
export function matchesConsumerMappingV2(input: unknown): boolean {
  const parsed = consumerComponentMappingV2Schema.safeParse(input);
  if (!parsed.success) return false;
  return (
    Object.keys(
      CONSUMER_COMPONENT_MAPPING_V2.states,
    ) as (keyof ConsumerComponentMappingV2["states"])[]
  ).every((state) => {
    const actual = parsed.data.states[state],
      fixed = CONSUMER_COMPONENT_MAPPING_V2.states[state];
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
