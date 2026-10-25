import rendererV1 from "./implementation-data/renderer-folio-preview-v1.json";
import archetypeV1 from "./implementation-data/engine-archetype-v1.json";
import dimensionsV1 from "./implementation-data/engine-dimensions-v1.json";
import rendererCurrent from "./implementation-data/renderer-folio-preview-v1-1.json";
import archetypeCurrent from "./implementation-data/engine-archetype-v1-security.json";
import dimensionsCurrent from "./implementation-data/engine-dimensions-v1-security.json";
import {
  rendererIdentitySchema,
  engineIdentitySchema,
  type RendererIdentity,
  type EngineIdentity,
} from "./identity-contracts";
import {
  rendererImplementationEntrySchema,
  engineImplementationEntrySchema,
  type ImplementationEntry,
} from "./implementation-schema";
function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) freeze(x);
    Object.freeze(v);
  }
  return v;
}
/** Immutable historical descriptors. Removing executable availability must never delete these facts. */
export const IMPLEMENTATION_DESCRIPTORS = freeze({
  renderers: [
    rendererImplementationEntrySchema.parse(rendererCurrent),
    rendererImplementationEntrySchema.parse(rendererV1),
  ],
  engines: [
    engineImplementationEntrySchema.parse(archetypeCurrent),
    engineImplementationEntrySchema.parse(dimensionsCurrent),
    engineImplementationEntrySchema.parse(archetypeV1),
    engineImplementationEntrySchema.parse(dimensionsV1),
  ],
});
export function implementationIdentity(
  entry: ImplementationEntry,
): RendererIdentity | EngineIdentity {
  const { kind, id, version } = entry.descriptor;
  return kind === "renderer"
    ? rendererIdentitySchema.parse({
        kind,
        id,
        version,
        entrySha256: entry.entrySha256,
      })
    : engineIdentitySchema.parse({
        kind,
        id,
        version,
        entrySha256: entry.entrySha256,
      });
}
export const implementationKey = (
  identity: RendererIdentity | EngineIdentity,
) =>
  JSON.stringify([
    identity.kind,
    identity.id,
    identity.version,
    identity.entrySha256,
  ]);
export function findRendererImplementationDescriptor(input: unknown) {
  const i = rendererIdentitySchema.safeParse(input);
  if (!i.success) return null;
  return (
    IMPLEMENTATION_DESCRIPTORS.renderers.find(
      (x) =>
        implementationKey(implementationIdentity(x)) ===
        implementationKey(i.data),
    ) ?? null
  );
}
export function findEngineImplementationDescriptor(input: unknown) {
  const i = engineIdentitySchema.safeParse(input);
  if (!i.success) return null;
  return (
    IMPLEMENTATION_DESCRIPTORS.engines.find(
      (x) =>
        implementationKey(implementationIdentity(x)) ===
        implementationKey(i.data),
    ) ?? null
  );
}
/** This map is intentionally separate from descriptor hashing. It never selects a nearest/latest version. */
export const IMPLEMENTATION_AVAILABILITY = Object.freeze({
  rendererV1: implementationKey(
    implementationIdentity(IMPLEMENTATION_DESCRIPTORS.renderers[0]!),
  ),
  archetypeV1: implementationKey(
    implementationIdentity(IMPLEMENTATION_DESCRIPTORS.engines[0]!),
  ),
  dimensionsV1: implementationKey(
    implementationIdentity(IMPLEMENTATION_DESCRIPTORS.engines[1]!),
  ),
});
export function rendererImplementationAvailable(identity: RendererIdentity) {
  return (
    implementationKey(identity) === IMPLEMENTATION_AVAILABILITY.rendererV1 &&
    findRendererImplementationDescriptor(identity) !== null
  );
}
export function engineImplementationAvailable(identity: EngineIdentity) {
  const key = implementationKey(identity);
  return (
    [
      IMPLEMENTATION_AVAILABILITY.archetypeV1,
      IMPLEMENTATION_AVAILABILITY.dimensionsV1,
    ].includes(key) && findEngineImplementationDescriptor(identity) !== null
  );
}
