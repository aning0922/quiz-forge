import type { Metadata } from "next";
import { HistoricalExploration } from "@/features/theme/historical/exploration";

export const metadata: Metadata = { title: "历史人物 · D1-A 视觉探索" };

export default function HistoricalStudyPage() {
  return <HistoricalExploration />;
}
