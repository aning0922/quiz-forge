import { handleConsumerRouteV1 } from "@/features/fulfillment/consumer-flow/http/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const startedAt = performance.now(),
    ids = await params;
  return handleConsumerRouteV1(
    request,
    { action: "report", ...ids },
    startedAt,
  );
}
