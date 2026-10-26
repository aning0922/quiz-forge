import type { Metadata } from "next";
import { StudioShell } from "@/features/studio/shell";
import { studioPageState } from "@/features/studio/page-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "运营 Studio",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const state = await studioPageState();
  return (
    <StudioShell
      authenticated={state.status === "authenticated"}
      session={state.status === "authenticated" ? state.session : undefined}
      identity={
        state.status === "authenticated"
          ? {
              label: state.session.operator.displayName,
              role: state.session.operator.role,
            }
          : undefined
      }
    >
      {children}
    </StudioShell>
  );
}
