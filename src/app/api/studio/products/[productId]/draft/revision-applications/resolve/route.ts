import { handleDraftRevisionHttp } from "@/features/studio/draft-revisions/http";
import { createProductDraftRevisionService } from "@/features/product/draft-revisions/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  const startedAt = performance.now(),
    ids = await params;
  return handleDraftRevisionHttp(
    request,
    { action: "resolve", ...ids },
    createProductDraftRevisionService(),
    startedAt,
  );
}
