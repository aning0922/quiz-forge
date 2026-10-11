import { redirect } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioUnavailable } from "@/features/studio/shell";
import { ProductDetail } from "@/features/studio/workspace/product-detail";

export default async function StudioProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "unauthenticated") redirect("/studio/login");
  const { productId } = await params;
  return <ProductDetail productId={productId} session={state.session} />;
}
