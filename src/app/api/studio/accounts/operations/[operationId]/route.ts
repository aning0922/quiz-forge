import { handleAccounts } from "@/lib/auth/accounts/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ operationId: string }> },
) {
  return handleAccounts(request, "result", (await context.params).operationId);
}
