import { handleValidationHttp } from "@/features/studio/validations/http";
import { createQuizpackValidationService } from "@/features/quizpack/validation/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      productId: string;
      importId: string;
      validationId: string;
    }>;
  },
) {
  const startedAt = performance.now();
  const ids = await params;
  return handleValidationHttp(
    request,
    { action: "read", ...ids },
    createQuizpackValidationService(),
    startedAt,
  );
}
