import { redirect, notFound } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioUnavailable } from "@/features/studio/shell";
import { internalRevisionScopeSchema } from "@/features/product/internal-versions/urls";
import { InternalVersionsPage } from "@/features/studio/internal-versions/pages";
export default async function Page({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "unauthenticated") redirect("/studio/login");
  const ids = await params,
    parsed = internalRevisionScopeSchema.shape.productId.safeParse(
      ids.productId,
    );
  if (!parsed.success) notFound();
  return (
    <InternalVersionsPage
      key={parsed.data}
      productId={parsed.data}
      session={state.session}
    />
  );
}
