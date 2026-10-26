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
  for (const entry of IMPLEMENTATION_DESCRIPTORS_V2.engines)
    if (!engineImplementationAvailableV2(implementationIdentityV2(entry)))
      throw Error("V2_ENGINE_BINDING_MISMATCH");
  for (const entry of IMPLEMENTATION_DESCRIPTORS_V2.renderers)
    if (!rendererImplementationAvailableV2(implementationIdentityV2(entry)))
      throw Error("V2_PREVIEW_BINDING_MISMATCH");
  for (const entry of CONSUMER_IMPLEMENTATION_DESCRIPTORS_V2)
    if (
      !consumerImplementationAvailableV2(
        consumerImplementationIdentityV2(entry),
      )
    )
      throw Error("V2_CONSUMER_BINDING_MISMATCH");
  return verifyTrustedImplementationEntries(
    cwd,
    [
      ...IMPLEMENTATION_DESCRIPTORS_V2.engines,
      ...IMPLEMENTATION_DESCRIPTORS_V2.renderers,
      ...CONSUMER_IMPLEMENTATION_DESCRIPTORS_V2,
    ],
    () => true,
  );
}
