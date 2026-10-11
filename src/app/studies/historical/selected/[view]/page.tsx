import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SelectedHistoricalCover } from "@/features/theme/historical/selected/cover";
import { SelectedHistoricalResult } from "@/features/theme/historical/selected/result";
import { historicalReportFixture } from "@/features/report/historical-fixture";

const views = ["cover", "result"] as const;
export function generateStaticParams() {
  return views.map((view) => ({ view }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ view: string }>;
}): Promise<Metadata> {
  const { view } = await params;
  return {
    title: `东方人物志 · ${view === "result" ? "合成结果长卷" : "未揭晓封面"} · 定向预览`,
  };
}
export default async function SelectedHistoricalPage({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;
  if (view === "cover") return <SelectedHistoricalCover />;
  if (view === "result")
    return <SelectedHistoricalResult report={historicalReportFixture} />;
  notFound();
}
