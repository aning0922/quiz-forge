import { handleConsumerRouteV1 } from "@/features/fulfillment/consumer-flow/http/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const startedAt = performance.now();
  return handleConsumerRouteV1(request, { action: "exchange" }, startedAt);
}
