import {
  currentPreviewResponseSchema,
  temporaryPreviewRequestV2Schema,
  temporaryPreviewResultResponseV2Schema,
  samePreviewBindingV2,
  PREVIEW_LIMITS_V2,
  type TemporaryPreviewRequestV2,
} from "@/features/product/preview/contracts-v2";
import {
  bindingUsesCurrentRenderer,
  type PreviewScope,
} from "@/features/product/preview/contracts";
import { currentPreviewApiPath } from "@/features/product/preview/urls-v2";
import {
  checkedPreviewError,
  withPreviewDeadline,
  PreviewClientError,
} from "./client";
import { readBoundedDraftJson } from "../drafts/response";
const options = {
  credentials: "same-origin",
  cache: "no-store",
  redirect: "error",
} as const;
export async function fetchCurrentPreviewEntry(
  scope: PreviewScope,
  signal: AbortSignal,
) {
  return withPreviewDeadline(signal, async (active, deadline) => {
    const response = await fetch(currentPreviewApiPath(scope), {
      ...options,
      signal: active,
    });
    if (!response.ok) await checkedPreviewError(response, active, deadline);
    if (response.status !== 200)
      throw new PreviewClientError("STUDIO_UNAVAILABLE");
    const { value } = currentPreviewResponseSchema.parse(
      await readBoundedDraftJson(
        response,
        PREVIEW_LIMITS_V2.entryResponseBytes,
        { signal: active, deadlineMonotonicMs: deadline },
      ),
    );
    const binding =
      value.mode === "legacy" ? value.binding : value.value.binding;
    if (
      binding.productId !== scope.productId ||
      binding.draftId !== scope.draftId ||
      binding.revision !== scope.revision ||
      (value.mode === "legacy" && !bindingUsesCurrentRenderer(value.binding))
    )
      throw new PreviewClientError("PREVIEW_BINDING_MISMATCH");
    return value;
  });
}
export async function fetchTemporaryPreviewV2(
  input: TemporaryPreviewRequestV2,
  csrf: string,
  signal: AbortSignal,
) {
  const request = temporaryPreviewRequestV2Schema.parse(input),
    body = JSON.stringify(request);
  if (
    new TextEncoder().encode(body).byteLength >
    PREVIEW_LIMITS_V2.scoreRequestBytes
  )
    throw new PreviewClientError("PREVIEW_LIMIT_EXCEEDED");
  return withPreviewDeadline(signal, async (active, deadline) => {
    const response = await fetch(
      currentPreviewApiPath(request.binding, "score"),
      {
        ...options,
        method: "POST",
        signal: active,
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body,
      },
    );
    if (!response.ok) await checkedPreviewError(response, active, deadline);
    if (response.status !== 200)
      throw new PreviewClientError("STUDIO_UNAVAILABLE");
    const { value } = temporaryPreviewResultResponseV2Schema.parse(
      await readBoundedDraftJson(
        response,
        PREVIEW_LIMITS_V2.revealResponseBytes,
        { signal: active, deadlineMonotonicMs: deadline },
      ),
    );
    if (
      !samePreviewBindingV2(value.binding, request.binding) ||
      value.requestId !== request.requestId
    )
      throw new PreviewClientError("PREVIEW_BINDING_MISMATCH");
    return value;
  });
}
