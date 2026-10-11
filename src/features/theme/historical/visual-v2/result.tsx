import Link from "next/link";
import { ArrowUpRight, BookOpen } from "lucide-react";
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
import { ResultAtlas } from "./result-atlas";
import { TemperamentInscriptionView } from "./inscription";
import atlasStyles from "./result-atlas.module.css";
import type { HistoricalReportView } from "@/features/report/historical-view";
import { findConceptPortrait } from "../selected/tokens";
import { StudyArt } from "./art";
import { PrimaryLink, StudyShell, studyPath, type Direction } from "./shared";
import styles from "./visual-v2.module.css";

function inscriptionPath(
  direction: Direction,
  view: "report" | "poster",
  inscription: TemperamentInscription | null,
) {
  const variant = inscription?.kind ?? "none";
  return `${studyPath(direction, view)}${variant === "classical" ? "" : `?inscription=${variant}`}`;
}

function Portrait({ report }: { report: HistoricalReportView }) {
  const asset = findConceptPortrait(report.identity.portraitAssetId);
  return asset ? (
    <StudyArt
      src={asset.src}
      alt={asset.alt}
      portrait
      className={styles.portrait ?? ""}
    />
  ) : (
    <p className={styles.missing}>该人物画作待补齐</p>
  );
}

export function CharacterPlate({
  direction,
  report,
  poster = false,
  copy,
  atlas,
  inscription = null,
}: {
  direction: Direction;
  report: HistoricalReportView;
  poster?: boolean;
  copy: HistoricalVisualCopy;
  atlas?: ResultAtlasView;
  inscription?: TemperamentInscription | null;
}) {
  const identity = report.identity;
  const verse =
    inscription && validateInscription(inscription) ? inscription : null;
  let featured: readonly ResultDimensionView[] = [];
  if (poster && atlas) {
    try {
      if (copy.posterDimensions.length < 2 || copy.posterDimensions.length > 3)
        throw new Error("Invalid poster references");
      featured = referencedDimensions(
        atlas,
        copy.posterDimensions.map((d) => d.dimensionId),
      );
    } catch {
      featured = [];
    }
  }
  return (
    <div
      className={`${styles.characterPlate} ${poster ? styles.posterPlate : ""}`}
      data-character-plate
    >
      <div className={styles.plateHalo} aria-hidden="true" />
      <p className={styles.plateTop}>
        {direction === "journey" ? "千载同心 / 人物志" : "千载同心 · 风骨藏馆"}
      </p>
      <div className={styles.plateIdentity}>
        <span>{identity.era}</span>
        <h1>{identity.name}</h1>
        <b>{copy.seal}</b>
      </div>
      <Portrait report={report} />
      <div className={styles.plateBottom}>
        <span className={styles.eyebrow}>{copy.englishTitle}</span>
        <h2>{identity.title}</h2>
        <p>
          {poster
            ? (verse?.posterLine ?? report.poster.shortLine)
            : identity.shortLine}
        </p>
        {poster && verse && (
          <p className={atlasStyles.posterAttribution}>
            {inscriptionAttribution(verse)}
          </p>
        )}
        {poster && (
          <div
            className={atlasStyles.posterTags}
            data-direction={direction}
            data-poster-tags
          >
            {featured.map((d, index) => (
              <span
                key={d.dimensionId}
                aria-label={`${d.label}：${d.normalizedScore} / 100，合成示意`}
              >
                {copy.posterDimensions[index]!.shortLabel}
                <b>{d.normalizedScore}</b>
                <small>/100</small>
              </span>
            ))}
          </div>
        )}
      </div>
      <div className={styles.plateFoot}>
        <span>{poster ? "娱乐性格测评 · 合成预览" : "艺术化概念形象"}</span>
        <span>{direction === "journey" ? "一卷相逢" : "概念编号 001"}</span>
      </div>
    </div>
  );
}

export function VisualReveal({
  direction,
  report,
  copy,
}: {
  direction: Direction;
  report: HistoricalReportView;
  copy: HistoricalVisualCopy;
}) {
  return (
    <StudyShell direction={direction} view="reveal">
      <section className={styles.reveal}>
        <div className={styles.revealIntro}>
          <p className={styles.eyebrow}>此刻，与你相逢</p>
          <h2>{copy.revealLead[direction]}</h2>
          <p className={styles.synthetic}>固定合成示例 · 非答题结论</p>
        </div>
        <CharacterPlate direction={direction} report={report} copy={copy} />
        <div className={styles.revealAction}>
          <p>{copy.revealClosing}</p>
          <PrimaryLink href={studyPath(direction, "report")}>
            读这份人物志
          </PrimaryLink>
          <Link
            prefetch={false}
            className={styles.textLink}
            href={studyPath(direction, "poster")}
          >
            看看收藏海报
            <ArrowUpRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </section>
    </StudyShell>
  );
}

export function VisualReport({
  direction,
  report,
  copy,
  atlas,
  inscription,
}: {
  direction: Direction;
  report: HistoricalReportView;
  copy: HistoricalVisualCopy;
  atlas: ResultAtlasView;
  inscription: TemperamentInscription | null;
}) {
  return (
    <StudyShell direction={direction} view="report">
      <article className={styles.report}>
        <header className={styles.reportHero}>
          <div>
            <p className={styles.eyebrow}>人物志 / THE INNER PORTRAIT</p>
            <h1>{copy.reportHeadline}</h1>
            <p className={styles.reportIdentity}>
              {report.identity.name}
              <span>{report.identity.title}</span>
            </p>
            <p className={styles.synthetic}>固定合成示例 · 非答题结论</p>
          </div>
          <div className={styles.reportPortrait}>
            <Portrait report={report} />
          </div>
        </header>
        <div className={styles.reportGrid}>
          <nav className={styles.reportNav} aria-label="报告章节">
            <a href="#character">性情侧写</a>
            <a href="#matching">匹配依据</a>
            <a href="#practice">相处指南</a>
            <a href="#footnotes">人物注脚</a>
          </nav>
          <div className={styles.reportContent}>
            <section id="overview" className={styles.overview}>
              <h2>{copy.oneLineResult}</h2>
            </section>
            <TemperamentInscriptionView
              inscription={inscription}
              direction={direction}
            />
            <ResultAtlas atlas={atlas} direction={direction} />
            <section id="matching" className={styles.reportSection}>
              <p className={styles.eyebrow}>03 / 匹配依据</p>
              <h2>数值与人物，怎样相连</h2>
              <p className={styles.sectionLead}>
                以下是固定编辑示意；尚未运行人物匹配规则。
              </p>
              <ul className={atlasStyles.matchNotes}>
                {copy.matchNotes.map((note) => {
                  let dimensions: readonly ResultDimensionView[] = [];
                  try {
                    dimensions = referencedDimensions(atlas, note.dimensionIds);
                  } catch {
                    return (
                      <li key={note.title}>
                        <p>关联维度资料待补齐。</p>
                      </li>
                    );
                  }
                  return (
                    <li key={note.title}>
                      <h3>{note.title}</h3>
                      <div className={atlasStyles.matchValues}>
                        {dimensions.map((d) => (
                          <span key={d.dimensionId}>
                            {d.label} {d.normalizedScore} / 100
                          </span>
                        ))}
                      </div>
                      <p>{note.explanation}</p>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section id="practice" className={styles.reportSection}>
              <p className={styles.eyebrow}>04 / 相处指南</p>
              <h2>留住光，也照见另一面</h2>
              <div className={styles.practice}>
                <section>
                  <span>让你发光的地方</span>
                  <h3>{copy.strengthHeading}</h3>
                  <ul>
                    {report.strengths.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </section>
                <section>
                  <span>可以多留意一点</span>
                  <h3>{copy.tradeoffHeading}</h3>
                  <ul>
                    {report.tradeoffs.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </section>
              </div>
              <p className={styles.note}>
                这些文字提供观察角度，不定义你的能力与未来。
              </p>
            </section>
            <section id="footnotes" className={styles.reportSection}>
              <p className={styles.eyebrow}>05 / 人物注脚</p>
              <h2>千年里，也有别样回声</h2>
              <div className={styles.similar}>
                {report.similarPeople.length ? (
                  report.similarPeople.map((p) => (
                    <div key={p.name}>
                      <h3>{p.name}</h3>
                      <p>{p.reason}</p>
                    </div>
                  ))
                ) : (
                  <p>相似人物资料待补齐。</p>
                )}
              </div>
              <details className={styles.explanation}>
                <summary>
                  <span className={styles.summaryLabel}>
                    <BookOpen size={18} aria-hidden="true" />
                    人物的时代与文化
                  </span>
                </summary>
                <p>{report.culture.text}</p>
                <p className={styles.note}>史实来源与内容审读待完成。</p>
              </details>
            </section>
            <section className={styles.reportOutro}>
              <span className={styles.eyebrow}>把这一次相逢，留在身边</span>
              <h2>{report.poster.shortLine}</h2>
              <p>把人物、短句与性情意象，收进一张画里。</p>
              <PrimaryLink
                href={inscriptionPath(direction, "poster", inscription)}
              >
                查看收藏海报
              </PrimaryLink>
            </section>
          </div>
        </div>
      </article>
    </StudyShell>
  );
}

export function VisualPoster({
  direction,
  report,
  copy,
  atlas,
  inscription,
}: {
  direction: Direction;
  report: HistoricalReportView;
  copy: HistoricalVisualCopy;
  atlas: ResultAtlasView;
  inscription: TemperamentInscription | null;
}) {
  return (
    <StudyShell
      direction={direction}
      view="poster"
      backHref={inscriptionPath(direction, "report", inscription)}
    >
      <section className={styles.posterPage}>
        <div className={styles.posterIntro}>
          <p className={styles.eyebrow}>A MOMENT TO KEEP</p>
          <h2>收藏这一次相逢</h2>
          <p>海报视觉概念 · 固定合成示例</p>
        </div>
        <CharacterPlate
          direction={direction}
          report={report}
          copy={copy}
          atlas={atlas}
          inscription={inscription}
          poster
        />
        <div className={styles.posterCaption}>
          <p>一张人物卡，装下此刻的心意。</p>
          <p className={styles.note}>
            当前为画幅与排版预览，尚未提供图片保存。
          </p>
          <Link
            prefetch={false}
            className={styles.textLink}
            href={inscriptionPath(direction, "report", inscription)}
          >
            回到人物志
            <ArrowUpRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </section>
    </StudyShell>
  );
}
