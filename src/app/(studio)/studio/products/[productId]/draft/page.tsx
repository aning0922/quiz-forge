import { redirect } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioUnavailable } from "@/features/studio/shell";
import { DraftWorkspacePage } from "@/features/studio/drafts/read-page";
export default async function StudioDraftPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "unauthenticated") redirect("/studio/login");
  const { productId } = await params;
  return (
    <DraftWorkspacePage
      key={productId}
      productId={productId}
      session={state.session}
    />
  );
}
