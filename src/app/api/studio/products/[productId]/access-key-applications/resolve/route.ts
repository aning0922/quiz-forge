import { handleStudioConsumerRouteV1 } from "@/features/studio/consumer-access/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  const startedAt = performance.now(),
    ids = await params;
  return handleStudioConsumerRouteV1(
    request,
    { action: "resolve-issue", ...ids },
    startedAt,
  );
}
