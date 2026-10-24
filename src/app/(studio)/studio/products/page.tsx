import { redirect } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioUnavailable } from "@/features/studio/shell";
import { ProductList } from "@/features/studio/workspace/product-list";

export default async function StudioProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "unauthenticated") redirect("/studio/login");
  return <ProductList session={state.session} search={await searchParams} />;
}
