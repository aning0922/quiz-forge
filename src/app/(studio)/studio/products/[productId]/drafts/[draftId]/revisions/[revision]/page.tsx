import { redirect } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioUnavailable } from "@/features/studio/shell";
import { DraftRevisionPage } from "@/features/studio/drafts/read-page";
export default async function StudioDraftRevisionPage({
  params,
}: {
  params: Promise<{ productId: string; draftId: string; revision: string }>;
}) {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "unauthenticated") redirect("/studio/login");
  const ids = await params;
  const revision =
    /^[1-9][0-9]{0,9}$/.test(ids.revision) && Number(ids.revision) <= 2147483647
      ? Number(ids.revision)
      : 0;
  return (
    <DraftRevisionPage
      key={`${ids.productId}/${ids.draftId}/${ids.revision}`}
      productId={ids.productId}
      draftId={ids.draftId}
      revision={revision}
    />
  );
}
