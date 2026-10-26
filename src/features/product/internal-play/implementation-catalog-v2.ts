import descriptor from "./implementation-data/consumer-structured-composed-v1.json";
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
  structured: consumerRendererIdentitySchema.parse({
    kind: "consumer-renderer",
    id: "consumer-structured-composed",
    version: "1.0.0",
    entrySha256:
      "5acbf78c420d13b5f785c153ba4a4f9f989cf2d7299b87149319b29c2f92e60c",
  }),
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
  return (
    key(consumerImplementationIdentityV2(entry)) ===
      key(CONSUMER_IMPLEMENTATION_AVAILABILITY_V2.structured) &&
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
