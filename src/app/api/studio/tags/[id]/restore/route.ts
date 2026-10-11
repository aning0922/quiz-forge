import { handleWorkspaceHttp } from "@/features/studio/workspace/http";
import * as service from "@/features/product/workspace/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return handleWorkspaceHttp(
    request,
    { domain: "tag", action: "restore", id: id },
    service,
  );
}
