import {
  previewEntryResponseSchema,
  previewRevealResponseSchema,
  previewHttpErrorSchema,
  previewScoreRequestSchema,
  bindingUsesCurrentRenderer,
  samePreviewBinding,
  type PreviewScope,
  type PreviewScoreRequest,
} from "@/features/product/preview/contracts";
import { PREVIEW_LIMITS } from "@/features/product/preview/limits";
import { previewApiPath } from "@/features/product/preview/urls";
import { readBoundedDraftJson } from "../drafts/response";

import {
  DisplayClientError as PreviewClientError,
  withDisplayDeadline as withPreviewDeadline,
} from "@/lib/browser/display-task";
export {
  DisplayClientError as PreviewClientError,
  withDisplayDeadline as withPreviewDeadline,
  checkpoint,
  awaitDisplayTask as awaitPreviewTask,
} from "@/lib/browser/display-task";
const statuses: Record<string, number> = {
  INVALID_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  UNAUTHENTICATED: 401,
  ORIGIN_REJECTED: 403,
  CSRF_REJECTED: 403,
  CAPABILITY_DENIED: 403,
  PRODUCT_NOT_FOUND: 404,
  DRAFT_NOT_FOUND: 404,
  DRAFT_REVISION_NOT_FOUND: 404,
  STUDIO_UNAVAILABLE: 503,
  PREVIEW_UNSUPPORTED: 422,
  PREVIEW_BINDING_MISMATCH: 409,
  PREVIEW_LIMIT_EXCEEDED: 422,
  PREVIEW_INVALID_ANSWERS: 422,
  PREVIEW_RESOURCE_UNAVAILABLE: 503,
  PREVIEW_BUSY: 503,
  PREVIEW_TIMEOUT: 504,
  PREVIEW_CANCELLED: 499,
};
export async function checkedPreviewError(
  response: Response,
  signal: AbortSignal,
  deadlineMonotonicMs: number,
): Promise<never> {
  const value = previewHttpErrorSchema.safeParse(
    await readBoundedDraftJson(response, PREVIEW_LIMITS.errorResponseBytes, {
      signal,
      deadlineMonotonicMs,
    }),
  );
  if (!value.success || statuses[value.data.code] !== response.status)
    throw new PreviewClientError("STUDIO_UNAVAILABLE");
  // This UUID observes the failed HTTP request; it is not a successful scoring requestId.
  throw new PreviewClientError(value.data.code);
}
const fetchOptions = {
  credentials: "same-origin",
  cache: "no-store",
  redirect: "error",
} as const;
export async function fetchPreviewEntry(
  scope: PreviewScope,
  signal: AbortSignal,
) {
  return withPreviewDeadline(signal, async (active, deadline) => {
    const response = await fetch(previewApiPath(scope), {
      ...fetchOptions,
      signal: active,
    });
    if (!response.ok) await checkedPreviewError(response, active, deadline);
    if (response.status !== 200)
      throw new PreviewClientError("STUDIO_UNAVAILABLE");
    const { value } = previewEntryResponseSchema.parse(
      await readBoundedDraftJson(response, PREVIEW_LIMITS.entryResponseBytes, {
        signal: active,
        deadlineMonotonicMs: deadline,
      }),
    );
    if (
      value.binding.productId !== scope.productId ||
      value.binding.draftId !== scope.draftId ||
      value.binding.revision !== scope.revision ||
      !bindingUsesCurrentRenderer(value.binding)
    )
      throw new PreviewClientError("PREVIEW_BINDING_MISMATCH");
    return value;
  });
}
export async function fetchPreviewScore(
  input: PreviewScoreRequest,
  csrf: string,
  signal: AbortSignal,
) {
  const request = previewScoreRequestSchema.parse(input),
    body = JSON.stringify(request);
  if (
    new TextEncoder().encode(JSON.stringify(request.answers)).byteLength >
      PREVIEW_LIMITS.answersBytes ||
    new TextEncoder().encode(body).byteLength > PREVIEW_LIMITS.scoreRequestBytes
  )
    throw new PreviewClientError("PREVIEW_LIMIT_EXCEEDED");
  return withPreviewDeadline(signal, async (active, deadline) => {
    const response = await fetch(previewApiPath(request.binding, "score"), {
      ...fetchOptions,
      method: "POST",
      signal: active,
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body,
    });
    if (!response.ok) await checkedPreviewError(response, active, deadline);
    if (response.status !== 200)
      throw new PreviewClientError("STUDIO_UNAVAILABLE");
    const { value } = previewRevealResponseSchema.parse(
      await readBoundedDraftJson(response, PREVIEW_LIMITS.revealResponseBytes, {
        signal: active,
        deadlineMonotonicMs: deadline,
      }),
    );
    if (
      !samePreviewBinding(value.binding, request.binding) ||
      value.requestId !== request.requestId
    )
      throw new PreviewClientError("PREVIEW_BINDING_MISMATCH");
    return value;
  });
}
export function previewMessage(error: unknown): string {
  switch (
    error instanceof PreviewClientError ? error.code : "STUDIO_UNAVAILABLE"
  ) {
    case "PREVIEW_UNSUPPORTED":
      return "此修订未注册可用预览。仍可阅读固定修订原文。";
    case "PREVIEW_BINDING_MISMATCH":
      return "固定修订绑定不一致。请返回原文核对后重新进入。";
    case "PREVIEW_LIMIT_EXCEEDED":
      return "此修订超过当前预览容量，无法完整展示。请阅读原文。";
    case "PREVIEW_INVALID_ANSWERS":
      return "答案未通过核验。请检查每题选择后重试。";
    case "PREVIEW_RESOURCE_UNAVAILABLE":
      return "当前素材无法核验或读取。请由维护者检查后重试。";
    case "PREVIEW_BUSY":
      return "素材读取繁忙，请稍后手动重试。";
    case "PREVIEW_TIMEOUT":
      return "预览请求超时，请手动重试。";
    case "PREVIEW_CANCELLED":
      return "预览请求已取消。";
    case "UNAUTHENTICATED":
      return "运营会话已失效，请重新登录。";
    case "CAPABILITY_DENIED":
      return "当前运营身份没有预览读取权限。";
    case "CSRF_REJECTED":
      return "登录验证已失效，请重新登录后再试。";
    case "DRAFT_REVISION_NOT_FOUND":
    case "DRAFT_NOT_FOUND":
    case "PRODUCT_NOT_FOUND":
      return "未找到此固定修订，请返回原文核对。";
    case "FONT_UNAVAILABLE":
      return "导出字体未完成核验，暂时无法生成 PNG。";
    case "FONT_COVERAGE":
      return "导出文字包含当前字体未覆盖的字符，暂时无法生成 PNG。";
    case "POSTER_LIMIT_EXCEEDED":
      return "内容超过此海报的完整排版容量，报告仍可阅读。";
    case "PNG_UNAVAILABLE":
      return "PNG 未能完成编码，请手动重试。";
    default:
      return "内部预览暂不可用，请由维护者检查后重试。";
  }
}
