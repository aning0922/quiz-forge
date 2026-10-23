import { redirect } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioUnavailable } from "@/features/studio/shell";
import { ProductCreatePage } from "@/features/studio/workspace/product-create";

export default async function StudioNewProductPage() {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "unauthenticated") redirect("/studio/login");
  return <ProductCreatePage session={state.session} />;
}
