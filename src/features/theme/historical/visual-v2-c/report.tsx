"use client";

import Link from "next/link";
import { ArrowUpRight, BookOpen, Sparkles } from "lucide-react";
import { historicalDisplayFixture } from "@/features/report/historical-display-fixture";
import { resolveHistoricalPosterArtwork } from "@/features/report/historical-poster-view";
import type { HistoricalReportView } from "@/features/report/historical-view";
import type { HistoricalVisualCopy } from "@/features/report/historical-visual-copy";
import {
  referencedDimensions,
  type ResultAtlasView,
  type ResultDimensionView,
} from "@/features/report/result-atlas";
import {
  inscriptionAttribution,
  validateInscription,
  type TemperamentInscription,
} from "@/features/report/temperament-inscription";
import { ResultAtlas } from "../visual-v2/result-atlas";
import { CandidateImage } from "./image";
import { visualV2CReportCopy as words } from "./report-copy";
import styles from "./report.module.css";

export interface VisualV2CReportProps {
  readonly report: HistoricalReportView;
  readonly copy: HistoricalVisualCopy;
  readonly atlas: ResultAtlasView;
  readonly inscription: TemperamentInscription | null;
  readonly query?: string;
}

function reportPath(view: "reveal" | "poster", query = "") {
  return `/studies/visual-v2-c/${view}${query}`;
}

function focusSection(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

function Dimensions({
  atlas,
  ids,
}: {
  atlas: ResultAtlasView;
  ids: readonly string[];
}) {
  let dimensions: readonly ResultDimensionView[] = [];
  try {
    dimensions = referencedDimensions(atlas, ids);
  } catch {
    return <p className={styles.pending}>关联维度资料待补齐。</p>;
  }
  return (
    <div className={styles.dimensionRefs}>
      {dimensions.map((dimension) => (
        <span key={dimension.dimensionId}>
          {dimension.label}
          <b>{dimension.normalizedScore}</b>
          <small>/100</small>
        </span>
      ))}
    </div>
  );
}

function CompactInscription({
  inscription,
}: {
  inscription: TemperamentInscription | null;
}) {
  if (!inscription || !validateInscription(inscription)) return null;
  return (
    <aside className={styles.inscription} aria-label="性情题签">
      <p className={styles.inscriptionLines}>
        <span>{inscription.lines[0]}</span>
        <span>{inscription.lines[1]}</span>
      </p>
      <details>
        <summary>{inscriptionAttribution(inscription)}</summary>
        <p>{inscription.interpretation}</p>
        {inscription.kind === "classical" ? (
          <a href={inscription.source.url} target="_blank" rel="noreferrer">
            来源：{inscription.source.title} ↗
          </a>
        ) : (
          <p>原创拟古 · 非古诗引用 · {inscription.credit}</p>
        )}
        <p>固定题签示例，未按答题或分数动态选择。</p>
      </details>
    </aside>
  );
}

export function VisualV2CReport({
  report,
  copy,
  atlas,
  inscription,
  query = "",
}: VisualV2CReportProps) {
  let portraitAvailable = true;
  try {
    resolveHistoricalPosterArtwork(report.identity.portraitAssetId);
  } catch {
    portraitAvailable = false;
  }
  return (
    <main className={styles.page} id="main" data-v2c="report">
      <header className={styles.header}>
        <Link href={reportPath("reveal", query)} prefetch={false}>
          千载同心 <small>QUIZFORGE</small>
        </Link>
        <span>人物相逢 · 合成示例</span>
      </header>

      <article className={styles.report}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>{words.eyebrow}</p>
          <div className={styles.identity}>
            <p>{report.identity.era}</p>
            <h1>{report.identity.name}</h1>
            <span aria-hidden="true">{copy.seal}</span>
          </div>
          <div className={styles.heroSummary}>
            {portraitAvailable ? (
              <CandidateImage
                asset="figure"
                eager
                alt={`${report.identity.name}艺术化概念形象的脸部与肩部裁取`}
                className={styles.figure}
                sizes="80px"
              />
            ) : (
              <p className={styles.figureMissing} role="status">
                人物画作未登记
              </p>
            )}
            <p className={styles.title}>{report.identity.title}</p>
            <p>{copy.oneLineResult}</p>
          </div>
          <p className={styles.disclosure}>{words.disclosure}</p>
        </header>

        <nav className={styles.nav} aria-label="报告章节">
          <a href="#atlas" onClick={() => focusSection("atlas")}>
            性情图谱
          </a>
          <a href="#matching" onClick={() => focusSection("matching")}>
            匹配依据
          </a>
          <a href="#practice" onClick={() => focusSection("practice")}>
            优势与留意
          </a>
          <a href="#culture" onClick={() => focusSection("culture")}>
            人物文化
          </a>
        </nav>

        <section className={styles.atlasSection} id="atlas" tabIndex={-1}>
          <CompactInscription inscription={inscription} />
          <ResultAtlas atlas={atlas} direction="collection" />
        </section>

        <section className={styles.section} id="matching" tabIndex={-1}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>02 / 匹配依据</p>
            <h2>{words.matchingTitle}</h2>
            <p>{words.matchingLead}</p>
          </div>
          <ol className={styles.matchNotes}>
            {copy.matchNotes.map((note) => (
              <li key={note.title}>
                <Sparkles size={17} aria-hidden="true" />
                <div>
                  <h3>{note.title}</h3>
                  <Dimensions atlas={atlas} ids={note.dimensionIds} />
                  <p>{note.explanation}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.section} id="practice" tabIndex={-1}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>03 / 优势与留意</p>
            <h2>{words.practiceTitle}</h2>
          </div>
          <div className={styles.practice}>
            <section>
              <p>{words.strengthsLabel}</p>
              <h3>{copy.strengthHeading}</h3>
              <ul>
                {report.strengths.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
            <section>
              <p>{words.tradeoffsLabel}</p>
              <h3>{copy.tradeoffHeading}</h3>
              <ul>
                {report.tradeoffs.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          </div>
          <p className={styles.note}>{words.note}</p>
        </section>

        <section className={styles.section} id="culture" tabIndex={-1}>
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>04 / 人物文化</p>
            <h2>{words.cultureTitle}</h2>
          </div>
          <div className={styles.similarPeople}>
            {report.similarPeople.map((person) => (
              <article key={person.name}>
                <span>相似人物</span>
                <h3>{person.name}</h3>
                <p>{person.reason}</p>
              </article>
            ))}
          </div>
          <details className={styles.culture}>
            <summary>
              <BookOpen size={18} aria-hidden="true" />
              {words.cultureLabel}
            </summary>
            <p>{report.culture.text}</p>
            <p className={styles.note}>史实来源与内容审读待完成。</p>
          </details>
        </section>

        <footer className={styles.posterCta}>
          <p className={styles.eyebrow}>把这一次相逢，留在身边</p>
          <h2>{report.poster.shortLine}</h2>
          <p>{words.posterLead}</p>
          <Link href={reportPath("poster", query)} prefetch={false}>
            查看收藏海报 <ArrowUpRight size={18} aria-hidden="true" />
          </Link>
        </footer>
      </article>
    </main>
  );
}

/**
 * V2-C's server-only study composition. Every value is an existing synthetic
 * display fixture; this component does not read answers, storage, or a score.
 */
export function ConvergedReport() {
  return (
    <VisualV2CReport
      report={historicalDisplayFixture.report}
      copy={historicalDisplayFixture.copy}
      atlas={historicalDisplayFixture.atlas}
      inscription={historicalDisplayFixture.inscription}
    />
  );
}
