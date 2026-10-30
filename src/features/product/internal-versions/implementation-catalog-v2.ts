import engine from "./implementation-data/engine-archetype-l1-v1.json";
import renderer from "./implementation-data/renderer-structured-composed-v1.json";
import { D3_IMPLEMENTATION_BINDINGS as current } from "./implementation-registration-v2";
import { QIANZAI_RUNTIME_INPUTS } from "@/features/theme/qianzai-tongxin/runtime-inputs";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { rendererIdentitySchema } from "./identity-contracts";
import { consumerEngineIdentityV2Schema } from "@/lib/consumer-contract/v2/identities";
import {
  engineImplementationEntryV2Schema,
  rendererImplementationEntryV2Schema,
  type InternalImplementationEntryV2,
} from "./implementation-schema-v2";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const IMPLEMENTATION_DESCRIPTORS_V2 = freeze({
  engines: [
    ...(current.engine ? [current.engine] : []),
    engineImplementationEntryV2Schema.parse(engine),
  ],
  renderers: [
    ...[current.structuredPreview, current.qianzaiPreview].filter(
      (v) => v !== null,
    ),
    rendererImplementationEntryV2Schema.parse(renderer),
  ],
});
const key = (value: {
  kind: string;
  id: string;
  version: string;
  entrySha256: string;
}) => JSON.stringify([value.kind, value.id, value.version, value.entrySha256]);
export function implementationIdentityV2(entry: InternalImplementationEntryV2) {
  const { kind, id, version } = entry.descriptor;
  return Object.freeze({ kind, id, version, entrySha256: entry.entrySha256 });
}
/** Literal compiled bindings. Neither database metadata nor a supplied descriptor grants availability. */
export const IMPLEMENTATION_AVAILABILITY_V2 = freeze({
  engine: consumerEngineIdentityV2Schema.parse(
    current.engine
      ? implementationIdentityV2(current.engine)
      : {
          kind: "engine",
          id: "archetype-l1",
          version: "1.0.0",
          entrySha256:
            "da17f5f9ae0c7fb63a92943d62e278e17174f5138e7f014bf5f93138c74b1c3b",
        },
  ),
  renderer: rendererIdentitySchema.parse(
    current.structuredPreview
      ? implementationIdentityV2(current.structuredPreview)
      : {
          kind: "renderer",
          id: "structured-composed-preview",
          version: "1.0.0",
          entrySha256:
            "0887d995a6b7035ea6a42cac233a958d3df9bc2d9e48fa475f405ab719f31e2d",
        },
  ),
});
/** Exact new source bindings only. The historical literals above remain facts, not availability. */
export const currentImplementationIdentitiesV2 = () => ({
  engine: current.engine ? implementationIdentityV2(current.engine) : null,
  renderer: current.structuredPreview
    ? implementationIdentityV2(current.structuredPreview)
    : null,
  qianzai: current.qianzaiPreview
    ? implementationIdentityV2(current.qianzaiPreview)
    : null,
});
export function findEngineImplementationDescriptorV2(input: unknown) {
  const parsed = consumerEngineIdentityV2Schema.safeParse(input);
  return parsed.success
    ? (IMPLEMENTATION_DESCRIPTORS_V2.engines.find(
        (entry) => key(implementationIdentityV2(entry)) === key(parsed.data),
      ) ?? null)
    : null;
}
export function findRendererImplementationDescriptorV2(input: unknown) {
  const parsed = rendererIdentitySchema.safeParse(input);
  return parsed.success
    ? (IMPLEMENTATION_DESCRIPTORS_V2.renderers.find(
        (entry) => key(implementationIdentityV2(entry)) === key(parsed.data),
      ) ?? null)
    : null;
}
export function engineImplementationAvailableV2(input: unknown) {
  const entry = findEngineImplementationDescriptorV2(input);
  return (
    !!entry &&
    current.engine !== null &&
    key(implementationIdentityV2(entry)) ===
      key(implementationIdentityV2(current.engine))
  );
}
export function rendererImplementationAvailableV2(input: unknown) {
  const entry = findRendererImplementationDescriptorV2(input);
  if (
    entry &&
    current.qianzaiPreview &&
    key(implementationIdentityV2(entry)) ===
      key(implementationIdentityV2(current.qianzaiPreview))
  )
    return (
      entry.descriptor.presentationMode === "authored-product" &&
      !entry.descriptor.exports.posterPng &&
      !entry.descriptor.exports.fullReportPng &&
      sameConsumerFact(entry.descriptor.font, QIANZAI_RUNTIME_INPUTS.font, 8192)
    );
  return (
    !!entry &&
    [current.structuredPreview, current.qianzaiPreview].some(
      (v) =>
        v !== null &&
        key(implementationIdentityV2(entry)) ===
          key(implementationIdentityV2(v)),
    )
  );
}
