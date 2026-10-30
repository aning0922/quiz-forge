import type { Metadata } from "next";
export const metadata: Metadata = {
  title: { absolute: "QuizForge · 在每一个世界里，遇见另一个自己" },
  description: "探索独立视觉与故事测评，凭有效兑换码进入对应作品或原报告。",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
