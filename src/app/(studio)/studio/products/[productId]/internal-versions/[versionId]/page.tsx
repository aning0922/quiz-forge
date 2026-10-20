import { redirect, notFound } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioUnavailable } from "@/features/studio/shell";
import { z } from "zod";
import { internalRevisionScopeSchema } from "@/features/product/internal-versions/urls";
import { InternalVersionDetailPage } from "@/features/studio/internal-versions/pages";
const scopeSchema = z.strictObject({
  productId: internalRevisionScopeSchema.shape.productId,
  versionId: z.uuid(),
});
export default async function Page({
  params,
}: {
  params: Promise<{ productId: string; versionId: string }>;
}) {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "unauthenticated") redirect("/studio/login");
  const parsed = scopeSchema.safeParse(await params);
  if (!parsed.success) notFound();
  return (
    <InternalVersionDetailPage
      key={`${parsed.data.productId}/${parsed.data.versionId}`}
      {...parsed.data}
      session={state.session}
    />
  );
}
