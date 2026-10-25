"use client";
import { useOwnedStudioSession } from "./accounts/session-owner";
import type { StudioSessionDto } from "./contracts";
import { MyAccountPage } from "./accounts/self-page";
export function StudioSessionPanel({
  session: initialSession,
}: {
  session: StudioSessionDto;
}) {
  const session = useOwnedStudioSession(initialSession);
  return <MyAccountPage session={session} />;
}
