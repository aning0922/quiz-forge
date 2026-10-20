import { handleConsumerRouteV1 } from "@/features/fulfillment/consumer-flow/http/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const startedAt = performance.now(),
    ids = await params;
  return handleConsumerRouteV1(request, { action: "save", ...ids }, startedAt);
}
