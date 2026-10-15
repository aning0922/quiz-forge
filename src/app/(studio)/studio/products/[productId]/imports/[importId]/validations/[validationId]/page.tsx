import { redirect } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioUnavailable } from "@/features/studio/shell";
import { ValidationDetailPage } from "@/features/studio/validations/detail-page";
export default async function StudioValidationPage({
  params,
}: {
  params: Promise<{
    productId: string;
    importId: string;
    validationId: string;
  }>;
}) {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "unauthenticated") redirect("/studio/login");
  const ids = await params;
  return (
    <ValidationDetailPage
      key={`${ids.productId}/${ids.importId}/${ids.validationId}`}
      session={state.session}
      {...ids}
    />
  );
}
