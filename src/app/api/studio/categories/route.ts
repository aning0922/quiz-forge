import { handleWorkspaceHttp } from "@/features/studio/workspace/http";
import * as service from "@/features/product/workspace/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleWorkspaceHttp(
    request,
    { domain: "category", action: "list" },
    service,
  );
}
export async function POST(request: Request) {
  return handleWorkspaceHttp(
    request,
    { domain: "category", action: "create" },
    service,
  );
}
