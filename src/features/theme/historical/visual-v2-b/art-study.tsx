import Link from "next/link";
import Image from "next/image";
import { ArrowDown, ArrowUpRight, ChevronLeft } from "lucide-react";
import type { HistoricalReportView } from "@/features/report/historical-view";
import type { HistoricalVisualCopy } from "@/features/report/historical-visual-copy";
import {
  referencedDimensions,
  type ResultAtlasView,
} from "@/features/report/result-atlas";
import {
  inscriptionAttribution,
  validateInscription,
  type TemperamentInscription,
} from "@/features/report/temperament-inscription";
import { ResultAtlas } from "../visual-v2/result-atlas";
import {
  artPath,
  artRecipes,
  type ArtDirection,
  type ArtView,
} from "./art-direction";
import { ArtImage } from "./art-image";
import styles from "./art-study.module.css";

export interface ArtStudyProps {
  direction: ArtDirection;
  view: ArtView;
  report: HistoricalReportView;
  copy: HistoricalVisualCopy;
  atlas: ResultAtlasView;
  inscription: TemperamentInscription | null;
  query: string;
}

function Verse({
  inscription,
}: {
  inscription: TemperamentInscription | null;
}) {
  if (!inscription || !validateInscription(inscription)) return null;
  return (
    <div className={styles.verse} data-art-verse>
      <blockquote>
        {inscription.lines.map((line, index) => (
          <span key={index}>{line}</span>
        ))}
      </blockquote>
      <p className={styles.attribution}>
        {inscriptionAttribution(inscription)}
        {inscription.kind === "original" && <span>非古诗引用</span>}
      </p>
    </div>
  );
}

function ArtworkComposition({
  direction,
  view,
  report,
  copy,
  atlas,
  inscription,
}: ArtStudyProps) {
  const recipe = artRecipes[direction];
  const poster = view === "poster";
  const tags = poster
    ? referencedDimensions(
        atlas,
        copy.posterDimensions.map((item) => item.dimensionId),
      )
    : [];
  return (
    <article
      className={`${styles.composition} ${poster ? styles.posterComposition : ""}`}
      data-collectible={poster ? "true" : undefined}
      aria-label={`${report.identity.name} · ${recipe.subtitle}${poster ? "收藏画作概念" : ""}`}
    >
      <ArtImage src={recipe.src} alt={recipe.alt} />
      <div className={styles.artOverprint} aria-hidden="true">
        <span>千载同心</span>
        <span>{poster ? "人物收藏 · 合成概念" : "此刻，与你相逢"}</span>
      </div>
      <div
        className={styles.identity}
        data-art-identity
        data-long-name={report.identity.name.length > 2 ? "true" : undefined}
      >
        <p>{report.identity.era}</p>
        <h1>{report.identity.name}</h1>
        <span className={styles.seal} aria-hidden="true">
          {copy.seal}
        </span>
      </div>
      <div className={styles.caption}>
        <p className={styles.edition}>{recipe.edition}</p>
        <h2>{report.identity.title}</h2>
        <Verse inscription={inscription} />
        {!inscription && (
          <p className={styles.shortLine}>{report.identity.shortLine}</p>
        )}
        {poster && (
          <div className={styles.posterTags}>
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
          {poster
            ? "SYNTHETIC · 娱乐性格测评合成预览"
            : "固定合成示例 · 非答题结论"}
        </p>
        {poster && <p className={styles.posterBrand}>千载同心 · QUIZFORGE</p>}
      </div>
    </article>
  );
}

function SourceNote({
  inscription,
}: {
  inscription: TemperamentInscription | null;
}) {
  if (!inscription || !validateInscription(inscription)) return null;
  return (
    <details className={styles.sourceNote}>
      <summary>题签解读与出处</summary>
      <p>{inscription.interpretation}</p>
      {inscription.kind === "classical" ? (
        <a href={inscription.source.url} target="_blank" rel="noreferrer">
          {inscription.source.title}
          <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      ) : (
        <p>{inscription.credit}；本例固定选用，未进行动态匹配。</p>
      )}
    </details>
  );
}

export function ArtStudy(props: ArtStudyProps) {
  const { direction, view, report, copy, atlas, inscription, query } = props;
  const recipe = artRecipes[direction];
  return (
    <main
      id="main"
      className={`${styles.shell} ${styles[direction]} ${styles[view]}`}
      data-v2b
      data-direction={direction}
      data-view={view}
    >
      {view !== "poster" && (
        <header className={styles.header}>
          <span className={styles.wordmark}>
            千载同心 <small>QUIZFORGE</small>
          </span>
          <span className={styles.headerNote}>人物相逢</span>
        </header>
      )}
      <div className={styles.stage}>
        <ArtworkComposition {...props} />
        {view === "reveal" && (
          <section className={styles.revealActions}>
            <p className={styles.desktopLead}>{copy.reportHeadline}</p>
            <p className={styles.revealSummary}>{copy.oneLineResult}</p>
            <Link
              className={styles.primary}
              href={artPath(direction, "report", query)}
              prefetch={false}
            >
              {recipe.action}
              <ArrowDown size={18} aria-hidden="true" />
            </Link>
            <Link
              className={styles.secondary}
              href={artPath(direction, "poster", query)}
              prefetch={false}
            >
              欣赏收藏画作
              <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
            <SourceNote inscription={inscription} />
          </section>
        )}
        {view === "report" && (
          <div className={styles.reportIntro}>
            <p className={styles.edition}>人物志 · {report.identity.name}</p>
            <h2>{copy.reportHeadline}</h2>
            <p>{report.identity.shortLine}</p>
            <a href="#character" className={styles.secondary}>
              循着性情，继续读下去
              <ArrowDown size={17} aria-hidden="true" />
            </a>
          </div>
        )}
      </div>
      {view === "report" && (
        <div className={styles.reportBody} data-report-transition>
          <div className={styles.chapterOpening} aria-hidden="true">
            <Image
              src={`/assets/themes/historical/visual-v2-b/chapter-${direction}.webp`}
              alt=""
              width={2172}
              height={724}
              unoptimized
            />
          </div>
          <section className={styles.bridge}>
            <p className={styles.edition}>从画中人，到性情的五个侧面</p>
            <h2>{copy.oneLineResult}</h2>
          </section>
          <div className={styles.atlasStage}>
            <ResultAtlas atlas={atlas} direction={recipe.baseline} />
          </div>
          <SourceNote inscription={inscription} />
          <div className={styles.reportActions}>
            <Link
              className={styles.primary}
              href={artPath(direction, "poster", query)}
              prefetch={false}
            >
              欣赏收藏画作
              <ArrowUpRight size={18} aria-hidden="true" />
            </Link>
            <Link
              className={styles.secondary}
              href={`/studies/visual-v2/${recipe.baseline}/report${inscription?.kind === "original" ? "?inscription=original" : inscription ? "" : "?inscription=none"}`}
              prefetch={false}
            >
              阅读完整报告
              <ArrowUpRight size={17} aria-hidden="true" />
            </Link>
            <p className={styles.continuation}>
              完整报告沿用上一版研究内容，含匹配示意、优势与留意之处、人物文化。
            </p>
          </div>
        </div>
      )}
      {view === "poster" && (
        <div className={styles.posterActions}>
          <p>收藏画作概念 · 尚未提供导出</p>
          <Link
            className={styles.secondary}
            href={artPath(direction, "report", query)}
            prefetch={false}
          >
            <ChevronLeft size={16} aria-hidden="true" />
            返回人物报告
          </Link>
          <Link
            className={styles.secondary}
            href={artPath(direction, "reveal", query)}
            prefetch={false}
          >
            返回人物揭晓
          </Link>
          <SourceNote inscription={inscription} />
        </div>
      )}
    </main>
  );
}
