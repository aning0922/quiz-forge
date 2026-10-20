import {
  previewScopeSchema,
  previewResourceRequestSchema,
  type PreviewScope,
  type PreviewResourceRequest,
} from "./contracts";
import { PREVIEW_LIMITS } from "./limits";
export function previewPagePath(input: PreviewScope): string {
  const s = previewScopeSchema.parse({
    productId: input.productId,
    draftId: input.draftId,
    revision: input.revision,
  });
  return `/studio/products/${encodeURIComponent(s.productId)}/drafts/${encodeURIComponent(s.draftId)}/revisions/${s.revision}/preview`;
}
export function previewApiPath(
  scope: PreviewScope,
  action: "entry" | "score" = "entry",
): string {
  return "/api" + previewPagePath(scope) + (action === "score" ? "/score" : "");
}
export function previewResourceUrl(input: PreviewResourceRequest): string {
  const value = previewResourceRequestSchema.parse(input);
  const query = new URLSearchParams({ q: JSON.stringify(value) }).toString();
  if (
    new TextEncoder().encode("?" + query).byteLength >
    PREVIEW_LIMITS.resourceQueryBytes
  )
    throw Error("INVALID_PREVIEW_RESOURCE_QUERY");
  return "/api" + previewPagePath(value.binding) + "/resource?" + query;
}
export function parsePreviewResourceQuery(url: URL): PreviewResourceRequest {
  if (
    new TextEncoder().encode(url.search).byteLength >
      PREVIEW_LIMITS.resourceQueryBytes ||
    url.searchParams.size !== 1 ||
    !url.searchParams.has("q")
  )
    throw Error("INVALID_PREVIEW_RESOURCE_QUERY");
  try {
    return previewResourceRequestSchema.parse(
      JSON.parse(url.searchParams.get("q")!),
    );
  } catch {
    throw Error("INVALID_PREVIEW_RESOURCE_QUERY");
  }
}
