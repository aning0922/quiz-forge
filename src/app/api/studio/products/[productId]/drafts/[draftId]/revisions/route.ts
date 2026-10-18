import { handleDraftRevisionHttp } from "@/features/studio/draft-revisions/http";
import { createProductDraftRevisionService } from "@/features/product/draft-revisions/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ productId: string; draftId: string }> },
) {
  const startedAt = performance.now(),
    ids = await params;
  return handleDraftRevisionHttp(
    request,
    { action: "history", ...ids },
    createProductDraftRevisionService(),
    startedAt,
  );
}
