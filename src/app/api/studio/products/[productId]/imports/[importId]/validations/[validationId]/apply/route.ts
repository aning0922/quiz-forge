import { handleDraftHttp } from "@/features/studio/drafts/http";
import { createProductDraftService } from "@/features/product/drafts/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      productId: string;
      importId: string;
      validationId: string;
    }>;
  },
) {
  const startedAt = performance.now();
  const ids = await params;
  return handleDraftHttp(
    request,
    { action: "apply", ...ids },
    createProductDraftService(),
    startedAt,
  );
}
