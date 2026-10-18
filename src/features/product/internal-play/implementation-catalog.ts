import rendererV1 from "./implementation-data/consumer-folio-cabinet-v1.json";
import {
  consumerImplementationEntrySchema,
  type ConsumerImplementationEntry,
} from "./implementation-schema";
import {
  consumerRendererIdentitySchema,
  type ConsumerRendererIdentity,
  CONSUMER_PROTOCOLS_V1,
} from "@/lib/consumer-contract/v1/identities";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  CONSUMER_RENDERER_V1,
  matchesConsumerMappingV1,
} from "@/features/theme/consumer-v1/component-map";
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
/** Historical facts remain even if their executable binding is withdrawn. */
export const CONSUMER_IMPLEMENTATION_DESCRIPTORS = freeze([
  consumerImplementationEntrySchema.parse(rendererV1),
]);
export function consumerImplementationIdentity(
  entry: ConsumerImplementationEntry,
): ConsumerRendererIdentity {
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
export const consumerImplementationKey = (identity: ConsumerRendererIdentity) =>
  JSON.stringify([
    identity.kind,
    identity.id,
    identity.version,
    identity.entrySha256,
  ]);
/** Explicit compiled identity, independent of supplied or historical descriptor metadata. */
export const CONSUMER_IMPLEMENTATION_AVAILABILITY = freeze({
  rendererV1: consumerRendererIdentitySchema.parse({
    kind: "consumer-renderer",
    id: "consumer-folio-cabinet",
    version: "1.0.0",
    entrySha256:
      "a77bab743b5827545add2272c0d7626e8699148a790e56fb6f365b76330adf46",
  }),
});
export function findConsumerImplementationDescriptor(input: unknown) {
  const parsed = consumerRendererIdentitySchema.safeParse(input);
  if (!parsed.success) return null;
  return (
    CONSUMER_IMPLEMENTATION_DESCRIPTORS.find(
      (entry) =>
        consumerImplementationKey(consumerImplementationIdentity(entry)) ===
        consumerImplementationKey(parsed.data),
    ) ?? null
  );
}
export function consumerImplementationAvailable(input: unknown) {
  const entry = findConsumerImplementationDescriptor(input);
  if (!entry) return false;
  const d = entry.descriptor;
  return (
    consumerImplementationKey(consumerImplementationIdentity(entry)) ===
      consumerImplementationKey(
        CONSUMER_IMPLEMENTATION_AVAILABILITY.rendererV1,
      ) &&
    d.id === CONSUMER_RENDERER_V1.id &&
    d.version === CONSUMER_RENDERER_V1.version &&
    matchesConsumerMappingV1(d.mapping) &&
    sameConsumerFact(
      d.protocols,
      CONSUMER_PROTOCOLS_V1,
      L.operationRequestBytes,
    )
  );
}
