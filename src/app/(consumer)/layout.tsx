import type { Metadata } from "next";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "QuizForge 内测体验",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function ConsumerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
