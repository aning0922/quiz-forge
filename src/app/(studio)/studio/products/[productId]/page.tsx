import { redirect, notFound } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioUnavailable } from "@/features/studio/shell";
import {
  ProductTaskWorkspace,
  type TaskTab,
} from "@/features/studio/product-workspace/task-workspace";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { consumerIdSchema } from "@/lib/consumer-contract/v1/primitives";
import { CONSUMER_IMPLEMENTATION_AVAILABILITY } from "@/features/product/internal-play/implementation-catalog";

export default async function StudioProductPage({
  searchParams,
  params,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  params: Promise<{ productId: string }>;
}) {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "unauthenticated") redirect("/studio/login");
  const product = consumerIdSchema.safeParse((await params).productId);
  if (!product.success) notFound();
  const config = await loadRuntimeConfig().catch(() => null);
  if (!config) return <StudioUnavailable />;
  const consumerScope = {
    origin: config.origin,
    instanceId: config.instanceId,
    issuerId: state.session.operator.id,
    productId: product.data,
  };
  const query = await searchParams;
  const task = query.task;
  const initialTask: TaskTab =
    task === "preview" || task === "review" || task === "testing"
      ? task
      : "content";
  return (
    <ProductTaskWorkspace
      session={state.session}
      initialTask={initialTask}
      consumerScope={consumerScope}
      consumerRenderer={CONSUMER_IMPLEMENTATION_AVAILABILITY.rendererV1_1}
    />
  );
}
