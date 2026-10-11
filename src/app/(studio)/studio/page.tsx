import { redirect } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioSessionPanel } from "@/features/studio/session-panel";
import { StudioUnavailable } from "@/features/studio/shell";

export default async function StudioPage() {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "unauthenticated") redirect("/studio/login");
  return <StudioSessionPanel session={state.session} />;
}
