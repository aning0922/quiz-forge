import { handlePreviewHttp } from "@/features/product/preview/http";
import { createProductPreviewService } from "@/features/product/preview/service";
import {
  preparePreviewContent,
  scorePreview,
} from "@/features/theme/preview/projection";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ productId: string; draftId: string; revision: string }>;
  },
) {
  const startedAt = performance.now(),
    ids = await params;
  return handlePreviewHttp(
    request,
    { ...ids, action: "score" },
    createProductPreviewService({ preparePreviewContent, scorePreview }),
    startedAt,
  );
}
