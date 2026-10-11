import { redirect } from "next/navigation";
import { studioPageState } from "@/features/studio/page-session";
import { StudioLoginForm } from "@/features/studio/login-form";
import { StudioUnavailable } from "@/features/studio/shell";

export default async function StudioLoginPage() {
  const state = await studioPageState();
  if (state.status === "unavailable") return <StudioUnavailable />;
  if (state.status === "authenticated") redirect("/studio");
  return <StudioLoginForm />;
}
