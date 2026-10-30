import descriptor from "./implementation-data/consumer-structured-composed-v1.json";
import { D3_IMPLEMENTATION_BINDINGS as current } from "../internal-versions/implementation-registration-v2";
import {
  QIANZAI_COMPONENT_MAPPING,
  QIANZAI_CONSUMER_RENDERER,
} from "@/features/theme/qianzai-tongxin/component-map";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { QIANZAI_RUNTIME_INPUTS } from "@/features/theme/qianzai-tongxin/runtime-inputs";
import { consumerRendererIdentitySchema } from "@/lib/consumer-contract/v1/identities";
import {
  consumerImplementationEntryV2Schema,
  type ConsumerImplementationEntryV2,
} from "./implementation-schema-v2";
import {
  CONSUMER_RENDERER_V2,
  matchesConsumerMappingV2,
} from "@/features/theme/consumer-v2/component-map";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const CONSUMER_IMPLEMENTATION_DESCRIPTORS_V2 = freeze([
  ...[current.structuredConsumer, current.qianzaiConsumer].filter(
    (v) => v !== null,
  ),
  consumerImplementationEntryV2Schema.parse(descriptor),
]);
export function consumerImplementationIdentityV2(
  entry: ConsumerImplementationEntryV2,
) {
  const { kind, id, version } = entry.descriptor;
  return Object.freeze(
    consumerRendererIdentitySchema.parse({
      kind,
      id,
      version,
      entrySha256: entry.entrySha256,
    }),
  );
}
const key = (value: {
  kind: string;
  id: string;
  version: string;
  entrySha256: string;
}) => JSON.stringify([value.kind, value.id, value.version, value.entrySha256]);
export const CONSUMER_IMPLEMENTATION_AVAILABILITY_V2 = freeze({
  structured: consumerRendererIdentitySchema.parse(
    current.structuredConsumer
      ? consumerImplementationIdentityV2(current.structuredConsumer)
      : {
          kind: "consumer-renderer",
          id: "consumer-structured-composed",
          version: "1.0.0",
          entrySha256:
            "e4149bca321883da85fc3029e34aba2ca7b05e22da572877c98448c3447fa6c1",
        },
  ),
  qianzai: current.qianzaiConsumer
    ? consumerImplementationIdentityV2(current.qianzaiConsumer)
    : null,
});
export function findConsumerImplementationDescriptorV2(input: unknown) {
  const parsed = consumerRendererIdentitySchema.safeParse(input);
  return parsed.success
    ? (CONSUMER_IMPLEMENTATION_DESCRIPTORS_V2.find(
        (entry) =>
          key(consumerImplementationIdentityV2(entry)) === key(parsed.data),
      ) ?? null)
    : null;
}
export function consumerImplementationAvailableV2(input: unknown) {
  const entry = findConsumerImplementationDescriptorV2(input);
  if (!entry) return false;
  const d = entry.descriptor;
  if (
    current.qianzaiConsumer &&
    key(consumerImplementationIdentityV2(entry)) ===
      key(consumerImplementationIdentityV2(current.qianzaiConsumer))
  )
    return (
      d.id === QIANZAI_CONSUMER_RENDERER.id &&
      d.version === QIANZAI_CONSUMER_RENDERER.version &&
      sameConsumerFact(d.mapping, QIANZAI_COMPONENT_MAPPING, 8192) &&
      d.presentationMode === "authored-product" &&
      !("kind" in d.font) &&
      sameConsumerFact(d.font, QIANZAI_RUNTIME_INPUTS.font, 8192) &&
      d.exports.posterPng &&
      d.exports.fullReportPng
    );
  return (
    current.structuredConsumer !== null &&
    key(consumerImplementationIdentityV2(entry)) ===
      key(consumerImplementationIdentityV2(current.structuredConsumer)) &&
    d.id === CONSUMER_RENDERER_V2.id &&
    d.version === CONSUMER_RENDERER_V2.version &&
    matchesConsumerMappingV2(d.mapping) &&
    d.presentationMode === "structured-only" &&
    !d.exports.posterPng &&
    !d.exports.fullReportPng &&
    "kind" in d.font &&
    d.font.kind === "system-structured" &&
    d.font.pngAvailable === false
  );
}
