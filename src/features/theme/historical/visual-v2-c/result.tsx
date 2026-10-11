import Link from "next/link";
import { ArrowRight, ArrowLeft, ArrowUpRight } from "lucide-react";
import { historicalDisplayFixture } from "@/features/report/historical-display-fixture";
import { createHistoricalPosterView } from "@/features/report/historical-poster-view";
import { referencedDimensions } from "@/features/report/result-atlas";
import { inscriptionAttribution } from "@/features/report/temperament-inscription";
import { HistoricalPosterExport } from "@/features/theme/historical/d1c-poster/export-panel";
import { artRecipes } from "../visual-v2-b/art-direction";
import { CandidateImage } from "./image";
import styles from "./candidate.module.css";

/** This entry imports fixtures only after the user's explicit synthetic reveal. */
export function CandidateResult({ poster = false }: { poster?: boolean }) {
  const { report, copy, atlas, inscription } = historicalDisplayFixture;
  if (!inscription) throw new Error("合成题签缺失，无法展示揭晓。");
  const posterView = poster
    ? createHistoricalPosterView(historicalDisplayFixture)
    : null;
  const tags = referencedDimensions(
    atlas,
    copy.posterDimensions.map((item) => item.dimensionId),
  );
  return (
    <main
      id="main"
      className={styles.result}
      data-v2c={poster ? "poster" : "reveal"}
    >
      {!poster && (
        <header className={styles.header}>
          <span>千载同心</span>
          <small>人物相逢 · 合成示例</small>
        </header>
      )}
      <div
        className={`${styles.resultStage} ${poster ? styles.posterStage : ""}`}
      >
        <article
          className={`${styles.art} ${poster ? styles.posterArt : ""}`}
          data-collectible={poster ? "true" : undefined}
          aria-label={`${report.identity.name} · ${poster ? "收藏海报概念" : "合成人物揭晓"}`}
        >
          <CandidateImage asset="figure" alt={artRecipes.celestial.alt} eager />
          <div className={styles.overprint}>
            <span>风骨映月</span>
            <span>
              {poster ? "人物收藏 · 合成概念" : "翻开这一页，看见一种风骨"}
            </span>
          </div>
          <div className={styles.artText}>
            <p className={styles.era}>{report.identity.era}</p>
            <h1>{report.identity.name}</h1>
            <h2>{report.identity.title}</h2>
            <blockquote>
              {inscription.lines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </blockquote>
            <p className={styles.attribution}>
              {inscriptionAttribution(inscription)}
            </p>
            {poster && (
              <div className={styles.tags}>
                {tags.map((dimension, index) => (
                  <span key={dimension.dimensionId}>
                    {copy.posterDimensions[index]!.shortLabel}
                    <b>{dimension.normalizedScore}</b>
                    <small>/100</small>
                  </span>
                ))}
              </div>
            )}
            <p className={styles.artDisclosure}>
              SYNTHETIC · 固定合成示例 · 非答题结论
            </p>
            {poster && (
              <p className={styles.posterBrand}>{posterView!.brand}</p>
            )}
          </div>
        </article>
        <section className={styles.resultActions}>
          {poster ? (
            <>
              <p>收藏海报作品预览 · 可生成一张带合成演示标记的 PNG。</p>
              <HistoricalPosterExport view={posterView!} />
              <Link
                className={styles.primary}
                href="/studies/visual-v2-c/report"
                prefetch={false}
              >
                <ArrowLeft size={18} aria-hidden="true" />
                返回完整人物志
              </Link>
              <Link
                className={styles.secondary}
                href="/studies/visual-v2-c/reveal"
                prefetch={false}
              >
                重看人物揭晓
              </Link>
            </>
          ) : (
            <>
              <p className={styles.resultSummary}>{copy.oneLineResult}</p>
              <Link
                className={styles.primary}
                href="/studies/visual-v2-c/report"
                prefetch={false}
              >
                翻阅完整人物志 <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link
                className={styles.secondary}
                href="/studies/visual-v2-c/poster"
                prefetch={false}
              >
                欣赏收藏画作 <ArrowUpRight size={16} aria-hidden="true" />
              </Link>
            </>
          )}
          <details className={styles.source}>
            <summary>题签出处与演示说明</summary>
            <p>{inscription.interpretation}</p>
            {inscription.kind === "classical" && (
              <a href={inscription.source.url} target="_blank" rel="noreferrer">
                {inscription.source.title}
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            )}
            <p>
              本例固定展示人物、题签与模拟分数，不由十二题计算。画作是待审原创
              AI 概念，不是史实肖像。
            </p>
          </details>
          <Link
            className={styles.backHome}
            href="/studies/visual-v2-c"
            prefetch={false}
          >
            返回藏馆封面
          </Link>
        </section>
      </div>
    </main>
  );
}
