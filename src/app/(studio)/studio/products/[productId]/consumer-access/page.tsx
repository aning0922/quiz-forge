import { redirect, notFound } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioUnavailable } from "@/features/studio/shell";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { consumerIdSchema } from "@/lib/consumer-contract/v1/primitives";
import { CONSUMER_IMPLEMENTATION_AVAILABILITY } from "@/features/product/internal-play/implementation-catalog";
import { StudioConsumerAccessPageV1 } from "@/features/studio/consumer-access/page";
export default async function Page({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "unauthenticated") redirect("/studio/login");
  const product = consumerIdSchema.safeParse((await params).productId);
  if (!product.success) notFound();
  const config = await loadRuntimeConfig().catch(() => null);
  if (!config) return <StudioUnavailable />;
  const scope = {
    origin: config.origin,
    instanceId: config.instanceId,
    issuerId: state.session.operator.id,
    productId: product.data,
  };
  return (
    <StudioConsumerAccessPageV1
      key={`${scope.instanceId}:${scope.issuerId}:${scope.productId}`}
      scope={scope}
      renderer={CONSUMER_IMPLEMENTATION_AVAILABILITY.rendererV1_2}
    />
  );
}
