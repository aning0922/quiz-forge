import { handleAccounts } from "@/lib/auth/accounts/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handleAccounts(request, "me");
}
