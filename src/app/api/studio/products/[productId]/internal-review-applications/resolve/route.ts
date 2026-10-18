import { handleInternalVersionHttp } from "@/features/studio/internal-versions/http";
import { createProductInternalVersionService } from "@/features/product/internal-versions/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  const startedAt = performance.now(),
    ids = await params;
  return handleInternalVersionHttp(
    request,
    { action: "resolve-review", ...ids },
    createProductInternalVersionService,
    startedAt,
  );
}
