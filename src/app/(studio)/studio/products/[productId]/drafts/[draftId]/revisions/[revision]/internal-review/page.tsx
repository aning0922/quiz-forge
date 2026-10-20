import { redirect, notFound } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioUnavailable } from "@/features/studio/shell";
import {
  internalRevisionScopeSchema,
  internalRevisionParam,
} from "@/features/product/internal-versions/urls";
import { InternalReviewPage } from "@/features/studio/internal-versions/pages";
export default async function Page({
  params,
}: {
  params: Promise<{ productId: string; draftId: string; revision: string }>;
}) {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "unauthenticated") redirect("/studio/login");
  const ids = await params;
  let revision: number;
  try {
    revision = internalRevisionParam(ids.revision);
  } catch {
    notFound();
  }
  const parsed = internalRevisionScopeSchema.safeParse({ ...ids, revision });
  if (!parsed.success) notFound();
  return (
    <InternalReviewPage
      key={`${parsed.data.productId}/${parsed.data.draftId}/${parsed.data.revision}`}
      scope={parsed.data}
      session={state.session}
    />
  );
}
