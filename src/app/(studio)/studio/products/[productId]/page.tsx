import { workspaceQuerySchema } from "@/features/studio/product-workspace/routes";
import { redirect, notFound } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioUnavailable } from "@/features/studio/shell";
import { ProductTaskWorkspace } from "@/features/studio/product-workspace/task-workspace";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { consumerIdSchema } from "@/lib/consumer-contract/v1/primitives";
import { CONSUMER_IMPLEMENTATION_AVAILABILITY } from "@/features/product/internal-play/implementation-catalog";

import { CONSUMER_IMPLEMENTATION_AVAILABILITY_V2 } from "@/features/product/internal-play/implementation-catalog-v2";

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
  const query = workspaceQuerySchema.safeParse(await searchParams);
  if (!query.success) notFound();
  const initialScope =
    query.data.draftId && query.data.revision
      ? {
          productId: product.data,
          draftId: query.data.draftId,
          revision: query.data.revision,
        }
      : undefined;
  return (
    <ProductTaskWorkspace
      session={state.session}
      initialTask={query.data.task}
      initialPanel={query.data.panel}
      initialScope={initialScope}
      consumerScope={consumerScope}
      consumerRenderers={{
        "quizforge.internal-version-snapshot.v1":
          CONSUMER_IMPLEMENTATION_AVAILABILITY.rendererV1_2,
        "quizforge.internal-version-snapshot.v2":
          CONSUMER_IMPLEMENTATION_AVAILABILITY_V2.structured,
        ...(CONSUMER_IMPLEMENTATION_AVAILABILITY_V2.qianzai
          ? { qianzai: CONSUMER_IMPLEMENTATION_AVAILABILITY_V2.qianzai }
          : {}),
      }}
    />
  );
}
