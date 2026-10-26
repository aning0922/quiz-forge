import { redirect } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioDashboard } from "@/features/studio/dashboard";
import { StudioUnavailable } from "@/features/studio/shell";

export default async function StudioPage() {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "unauthenticated") redirect("/studio/login");
  return <StudioDashboard session={state.session} />;
}
