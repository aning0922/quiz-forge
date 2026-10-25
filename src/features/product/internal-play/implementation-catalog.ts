import rendererV1 from "./implementation-data/consumer-folio-cabinet-v1.json";
import rendererV1_1 from "./implementation-data/consumer-folio-cabinet-v1-1.json";
import rendererV1_2 from "./implementation-data/consumer-folio-cabinet-v1-2.json";
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
  consumerImplementationEntrySchema.parse(rendererV1_2),
  consumerImplementationEntrySchema.parse(rendererV1),
  consumerImplementationEntrySchema.parse(rendererV1_1),
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
  rendererV1_2: consumerRendererIdentitySchema.parse({
    kind: "consumer-renderer",
    id: "consumer-folio-cabinet",
    version: "1.0.2",
    entrySha256:
      "1d310170ff1c86d8090b41502b89c03d10f6730c9d1aedd31c73c665bdb3e8a5",
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
  const executable = Object.values(CONSUMER_IMPLEMENTATION_AVAILABILITY).find(
    (identity) =>
      consumerImplementationKey(identity) ===
      consumerImplementationKey(consumerImplementationIdentity(entry)),
  );
  return (
    executable !== undefined &&
    d.id === CONSUMER_RENDERER_V1.id &&
    d.version === executable.version &&
    matchesConsumerMappingV1(d.mapping) &&
    sameConsumerFact(
      d.protocols,
      CONSUMER_PROTOCOLS_V1,
      L.operationRequestBytes,
    )
  );
}
