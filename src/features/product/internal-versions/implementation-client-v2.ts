import { StudioStructurePreviewV2 } from "@/features/theme/consumer-v2/studio-structure-preview";
import {
  implementationIdentityV2,
  rendererImplementationAvailableV2,
  findRendererImplementationDescriptorV2,
} from "./implementation-catalog-v2";
import { QianzaiFixedPreview } from "@/features/theme/qianzai-tongxin/fixed-preview";
import { QIANZAI_PREVIEW_RENDERER } from "@/features/theme/qianzai-tongxin/component-map";

/** Only temporary Studio projections are accepted; persisted consumer receipts are not fabricated. */
export function resolveRendererClientV2(input: unknown) {
  if (!rendererImplementationAvailableV2(input)) return null;
  const entry = findRendererImplementationDescriptorV2(input)!;
  return Object.freeze({
    identity: implementationIdentityV2(entry),
    descriptor: entry.descriptor,
    Preview:
      entry.descriptor.id === QIANZAI_PREVIEW_RENDERER.id
        ? QianzaiFixedPreview
        : StudioStructurePreviewV2,
  });
}
