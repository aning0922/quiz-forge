import { handleAccounts } from "@/lib/auth/accounts/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handleAccounts(request, "revoke", (await context.params).id);
}
