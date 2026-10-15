import { redirect, notFound } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioUnavailable } from "@/features/studio/shell";
import { previewScopeSchema } from "@/features/product/preview/contracts";
import { FixedRevisionPreviewPage } from "@/features/studio/preview/page";
export default async function PreviewPage({
  params,
}: {
  params: Promise<{ productId: string; draftId: string; revision: string }>;
}) {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "unauthenticated") redirect("/studio/login");
  const ids = await params,
    parsed = previewScopeSchema.safeParse({
      ...ids,
      revision: /^[1-9][0-9]{0,9}$/.test(ids.revision)
        ? Number(ids.revision)
        : 0,
    });
  if (!parsed.success) notFound();
  return (
    <FixedRevisionPreviewPage
      key={`${ids.productId}/${ids.draftId}/${ids.revision}`}
      scope={parsed.data}
      session={state.session}
    />
  );
}
