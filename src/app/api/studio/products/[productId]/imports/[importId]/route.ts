import { handleImportHttp } from "@/features/studio/imports/http";
import { importReceiveService } from "@/features/quizpack/import/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ productId: string; importId: string }> },
) {
  const startedAt = performance.now();
  const ids = await params;
  return handleImportHttp(
    request,
    { action: "read", ...ids },
    importReceiveService,
    startedAt,
  );
}
