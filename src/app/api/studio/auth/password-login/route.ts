import { handleAccounts } from "@/lib/auth/accounts/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return handleAccounts(request, "password-login");
}
