import Link from "next/link";
import { historicalDisplayFixture } from "@/features/report/historical-display-fixture";
import { getStudyInscription } from "@/features/report/historical-inscriptions";
import { createHistoricalPosterView } from "@/features/report/historical-poster-view";
import { HistoricalPosterExport } from "@/features/theme/historical/d1c-poster/export-panel";

/** Fixed synthetic QA fixtures only. No query text/URLs are passed into the artwork. */
export default async function PosterChecks({
  searchParams,
}: {
  searchParams: Promise<{ sample?: string }>;
}) {
  const { sample } = await searchParams;
  const base = createHistoricalPosterView(historicalDisplayFixture);
  const view =
    sample === "long"
      ? {
          ...base,
          identity: {
            ...base.identity,
            name: "心有远方也自有方向的浪漫自由行路者",
            title: "愿意寻找新的可能也珍视自己选择道路空间的浪漫自由行路者",
          },
          inscription: {
            kind: "original" as const,
            lines: [
              "借得松风开远意且将星月作行囊",
              "心有远方也自有方向将心事写成远方",
            ],
            attribution: "原创拟古 · QuizForge",
          },
        }
      : sample === "original"
        ? createHistoricalPosterView({
            ...historicalDisplayFixture,
            inscription: getStudyInscription("original"),
          })
        : sample === "unknown"
          ? {
              ...base,
              artwork: { ...base.artwork, assetId: "unregistered-person" },
            }
          : sample === "glyph"
            ? { ...base, identity: { ...base.identity, name: "龘" } }
            : base;
  return (
    <main id="main" style={{ maxWidth: 640, margin: "auto", padding: 20 }}>
      <h1>海报边界检查 · 合成排版夹具</h1>
      <p>
        这些固定长文和异常只用于检查导出，名称不是人物匹配，文字未完成文学审读；不改变正式演示的报告数据。
      </p>
      <Link href="/studies/visual-v2-c/poster" prefetch={false}>
        返回收藏海报
      </Link>
      <HistoricalPosterExport view={view} />
    </main>
  );
}
