import { notFound } from "next/navigation";
import { historicalReportFixture } from "@/features/report/historical-fixture";
import { VisualCover } from "@/features/theme/historical/visual-v2/cover";
import { VisualQuestion } from "@/features/theme/historical/visual-v2/question";
import {
  VisualPoster,
  VisualReport,
  VisualReveal,
} from "@/features/theme/historical/visual-v2/result";

export const metadata = { title: "千载同心 · 视觉体验" };

export default async function VisualStudyPage({
  params,
}: {
  params: Promise<{ direction: string; view: string }>;
}) {
  const { direction, view } = await params;
  if (direction !== "journey" && direction !== "collection") notFound();
  if (view === "cover") return <VisualCover direction={direction} />;
  if (view === "question") return <VisualQuestion direction={direction} />;
  // Synthetic DTO only enters explicit result research routes, never the question controller.
  if (view === "reveal")
    return (
      <VisualReveal direction={direction} report={historicalReportFixture} />
    );
  if (view === "report")
    return (
      <VisualReport direction={direction} report={historicalReportFixture} />
    );
  if (view === "poster")
    return (
      <VisualPoster direction={direction} report={historicalReportFixture} />
    );
  notFound();
}
