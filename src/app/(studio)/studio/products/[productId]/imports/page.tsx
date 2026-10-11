import { redirect } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioUnavailable } from "@/features/studio/shell";
import { ImportList } from "@/features/studio/imports/import-pages";

export default async function StudioImportsPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "unauthenticated") redirect("/studio/login");
  const { productId } = await params;
  return <ImportList productId={productId} session={state.session} />;
}
