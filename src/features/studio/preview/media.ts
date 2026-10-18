import {
  previewBindingSchema,
  type PreviewAsset,
  type PreviewBinding,
} from "@/features/product/preview/contracts";
import type { DisplayResourceTransport } from "@/lib/assessment-contract/display-v1";
import { previewResourceUrl } from "@/features/product/preview/urls";
import { checkedPreviewError } from "./client";
import { loadVerifiedImage } from "@/lib/browser/display-assets";
export {
  sha256,
  readVerifiedBytes,
  type VerifiedImage,
} from "@/lib/browser/display-assets";

/** Only this compiled adapter selects the authenticated fixed-revision URL. */
export function createPreviewResourceTransport(
  input: PreviewBinding,
): DisplayResourceTransport {
  const binding = previewBindingSchema.parse(input);
  Object.freeze(binding.renderer);
  Object.freeze(binding.font);
  Object.freeze(binding);
  return async (asset, active, deadline) => {
    const response = await fetch(
      previewResourceUrl({ binding, resourceRef: asset.resourceRef }),
      {
        signal: active,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
      },
    );
    if (!response.ok) await checkedPreviewError(response, active, deadline);
    return response;
  };
}
export function loadPreviewImage(
  binding: PreviewBinding,
  asset: PreviewAsset,
  signal: AbortSignal,
) {
  return loadVerifiedImage(
    asset,
    createPreviewResourceTransport(binding),
    signal,
  );
}
