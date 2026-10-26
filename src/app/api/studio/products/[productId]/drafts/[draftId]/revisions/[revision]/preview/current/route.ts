import { handleCurrentPreviewHttp } from "@/features/product/preview/http-v2";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ productId: string; draftId: string; revision: string }>;
  },
) {
  const startedAt = performance.now(),
    ids = await params;
  return handleCurrentPreviewHttp(
    request,
    { ...ids, action: "entry" },
    startedAt,
  );
}
