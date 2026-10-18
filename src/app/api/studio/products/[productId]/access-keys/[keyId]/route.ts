import { handleStudioConsumerRouteV1 } from "@/features/studio/consumer-access/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ productId: string; keyId: string }> },
) {
  const startedAt = performance.now(),
    ids = await params;
  return handleStudioConsumerRouteV1(
    request,
    { action: "read-key", ...ids },
    startedAt,
  );
}
