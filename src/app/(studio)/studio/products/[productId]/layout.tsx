import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioUnavailable } from "@/features/studio/shell";
import { ProductWorkspaceFrame } from "@/features/studio/product-workspace/frame";

export default async function ProductWorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ productId: string }>;
}) {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "unauthenticated") redirect("/studio/login");
  const { productId } = await params;
  return (
    <ProductWorkspaceFrame key={productId} productId={productId}>
      {children}
    </ProductWorkspaceFrame>
  );
}
