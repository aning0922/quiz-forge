import { handleStudioAuth } from "@/lib/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return handleStudioAuth(request, "login");
}
