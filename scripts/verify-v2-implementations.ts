import { verifyTrustedImplementationEntries } from "./verify-internal-implementations";
import {
  IMPLEMENTATION_DESCRIPTORS_V2,
  implementationIdentityV2,
  engineImplementationAvailableV2,
  rendererImplementationAvailableV2,
} from "../src/features/product/internal-versions/implementation-catalog-v2";
import {
  CONSUMER_IMPLEMENTATION_DESCRIPTORS_V2,
  consumerImplementationIdentityV2,
  consumerImplementationAvailableV2,
} from "../src/features/product/internal-play/implementation-catalog-v2";

/** Build gate for compiled v2 catalogs; it grants no database review or content approval. */
export async function verifyV2Implementations(cwd: string) {
  if (
    IMPLEMENTATION_DESCRIPTORS_V2.engines.filter((e) =>
      engineImplementationAvailableV2(implementationIdentityV2(e)),
    ).length !== 1 ||
    IMPLEMENTATION_DESCRIPTORS_V2.renderers.filter((e) =>
      rendererImplementationAvailableV2(implementationIdentityV2(e)),
    ).length !== 2 ||
    CONSUMER_IMPLEMENTATION_DESCRIPTORS_V2.filter((e) =>
      consumerImplementationAvailableV2(consumerImplementationIdentityV2(e)),
    ).length !== 2
  )
    throw Error("D3_FINAL_BINDINGS_REQUIRED");
  return verifyTrustedImplementationEntries(
    cwd,
    [
      ...IMPLEMENTATION_DESCRIPTORS_V2.engines,
      ...IMPLEMENTATION_DESCRIPTORS_V2.renderers,
      ...CONSUMER_IMPLEMENTATION_DESCRIPTORS_V2,
    ],
    (entry) => {
      const identity = {
        kind: entry.descriptor.kind,
        id: entry.descriptor.id,
        version: entry.descriptor.version,
        entrySha256: entry.entrySha256,
      };
      return identity.kind === "consumer-renderer"
        ? consumerImplementationAvailableV2(identity)
        : identity.kind === "engine"
          ? engineImplementationAvailableV2(identity)
          : rendererImplementationAvailableV2(identity);
    },
  );
}
