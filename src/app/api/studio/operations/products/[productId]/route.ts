import { handleOperationsHttp } from "@/features/studio/operations/http";
import { operationsService } from "@/features/studio/operations/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  const { productId } = await params;
  return handleOperationsHttp(
    request,
    { action: "detail", productId },
    operationsService,
  );
}
