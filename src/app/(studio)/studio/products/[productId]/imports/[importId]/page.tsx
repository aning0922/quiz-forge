import { redirect } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioUnavailable } from "@/features/studio/shell";
import { ImportDetail } from "@/features/studio/imports/import-pages";

export default async function StudioImportPage({
  params,
}: {
  params: Promise<{ productId: string; importId: string }>;
}) {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "unauthenticated") redirect("/studio/login");
  const { productId, importId } = await params;
  return (
    <ImportDetail
      productId={productId}
      importId={importId}
      session={state.session}
    />
  );
}
