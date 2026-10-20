import { handleImportHttp } from "@/features/studio/imports/http";
import { importReceiveService } from "@/features/quizpack/import/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  const startedAt = performance.now();
  const ids = await params;
  return handleImportHttp(
    request,
    { action: "list", ...ids },
    importReceiveService,
    startedAt,
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ productId: string }> },
) {
  const startedAt = performance.now();
  const ids = await params;
  return handleImportHttp(
    request,
    { action: "create", ...ids },
    importReceiveService,
    startedAt,
  );
}
