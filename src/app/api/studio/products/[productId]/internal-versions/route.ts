import { handleInternalVersionHttp } from "@/features/studio/internal-versions/http";
import { createProductInternalVersionService } from "@/features/product/internal-versions/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  const startedAt = performance.now(),
    ids = await params;
  return handleInternalVersionHttp(
    request,
    { action: "list", ...ids },
    createProductInternalVersionService,
    startedAt,
  );
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  const startedAt = performance.now(),
    ids = await params;
  return handleInternalVersionHttp(
    request,
    { action: "seal", ...ids },
    createProductInternalVersionService,
    startedAt,
  );
}
