import { StudioStructurePreviewV2 } from "@/features/theme/consumer-v2/studio-structure-preview";
import {
  IMPLEMENTATION_AVAILABILITY_V2,
  rendererImplementationAvailableV2,
  findRendererImplementationDescriptorV2,
} from "./implementation-catalog-v2";

/** Only temporary Studio projections are accepted; persisted consumer receipts are not fabricated. */
export function resolveRendererClientV2(input: unknown) {
  if (!rendererImplementationAvailableV2(input)) return null;
  const entry = findRendererImplementationDescriptorV2(input)!;
  return Object.freeze({
    identity: IMPLEMENTATION_AVAILABILITY_V2.renderer,
    descriptor: entry.descriptor,
    Preview: StudioStructurePreviewV2,
  });
}
