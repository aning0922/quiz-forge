import type { Metadata } from "next";
import { StudioShell } from "@/features/studio/shell";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "运营 Studio",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <StudioShell>{children}</StudioShell>;
}
