import { redirect } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioUnavailable } from "@/features/studio/shell";
import { DraftRevisionPage } from "@/features/studio/drafts/read-page";
import Link from "next/link";
import { previewScopeSchema } from "@/features/product/preview/contracts";
import {
  internalReviewPageUrl,
  internalRevisionScopeSchema,
} from "@/features/product/internal-versions/urls";
import { previewPagePath } from "@/features/product/preview/urls";
export default async function StudioDraftRevisionPage({
  params,
}: {
  params: Promise<{ productId: string; draftId: string; revision: string }>;
}) {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "unauthenticated") redirect("/studio/login");
  const ids = await params;
  const revision =
    /^[1-9][0-9]{0,9}$/.test(ids.revision) && Number(ids.revision) <= 2147483647
      ? Number(ids.revision)
      : 0;
  const scope = previewScopeSchema.safeParse({ ...ids, revision });
  const internalScope = internalRevisionScopeSchema.safeParse({
    ...ids,
    revision,
  });
  return (
    <DraftRevisionPage
      key={`${ids.productId}/${ids.draftId}/${ids.revision}`}
      productId={ids.productId}
      draftId={ids.draftId}
      revision={revision}
      navigation={
        <>
          {scope.success && (
            <p>
              <Link
                href={previewPagePath(scope.data)}
                style={{
                  display: "inline-flex",
                  minHeight: 44,
                  alignItems: "center",
                  textDecoration: "underline",
                }}
              >
                进入此固定修订内部预览
              </Link>
            </p>
          )}
          {internalScope.success && (
            <p>
              <Link
                href={internalReviewPageUrl(internalScope.data)}
                style={{
                  display: "inline-flex",
                  minHeight: 44,
                  alignItems: "center",
                  textDecoration: "underline",
                }}
              >
                查看此固定修订既有基线与内测封存
              </Link>
            </p>
          )}
        </>
      }
    />
  );
}
