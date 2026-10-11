import Link from "next/link";
import { ArrowDown, ArrowUpRight, BookOpen } from "lucide-react";
import type { HistoricalReportView } from "@/features/report/historical-view";
import { findConceptPortrait } from "../selected/tokens";
import { StudyArt } from "./art";
import { PrimaryLink, StudyShell, studyPath, type Direction } from "./shared";
import styles from "./visual-v2.module.css";

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
}: {
  direction: Direction;
  report: HistoricalReportView;
  poster?: boolean;
}) {
  const identity = report.identity;
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
        <b>逸</b>
      </div>
      <Portrait report={report} />
      <div className={styles.plateBottom}>
        <span className={styles.eyebrow}>THE WANDERING SOUL</span>
        <h2>{identity.title}</h2>
        <p>{identity.shortLine}</p>
        {poster && (
          <div className={styles.posterKeywords}>
            <span>自主</span>
            <span>探索</span>
            <span>表达</span>
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
}: {
  direction: Direction;
  report: HistoricalReportView;
}) {
  return (
    <StudyShell direction={direction} view="reveal">
      <section className={styles.reveal}>
        <div className={styles.revealIntro}>
          <p className={styles.eyebrow}>此刻，与你相逢</p>
          <h2>
            {direction === "journey" ? (
              <>
                山河之间，
                <br />
                遇见自由的回声。
              </>
            ) : (
              <>
                翻开这一页，
                <br />
                看见一种风骨。
              </>
            )}
          </h2>
          <p className={styles.synthetic}>固定合成示例 · 非答题结论</p>
        </div>
        <CharacterPlate direction={direction} report={report} />
        <div className={styles.revealAction}>
          <p>心有远方，也自有方向。</p>
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

const tendency = {
  prominent: "较突出",
  balanced: "较均衡",
  reserved: "较内敛",
};

export function VisualReport({
  direction,
  report,
}: {
  direction: Direction;
  report: HistoricalReportView;
}) {
  return (
    <StudyShell direction={direction} view="report">
      <article className={styles.report}>
        <header className={styles.reportHero}>
          <div>
            <p className={styles.eyebrow}>人物志 / THE INNER PORTRAIT</p>
            <h1>
              心有旷野，
              <br />
              行路自有光。
            </h1>
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
            <a href="#overview">一眼读懂</a>
            <a href="#character">性情侧写</a>
            <a href="#practice">相处指南</a>
            <a href="#footnotes">人物注脚</a>
          </nav>
          <div className={styles.reportContent}>
            <section id="overview" className={styles.overview}>
              <p className={styles.eyebrow}>01 / 一眼读懂</p>
              <h2>
                被新鲜的可能点亮，
                <br />
                也珍视自己的方向。
              </h2>
              <p>
                在这个人物意象里，探索与表达走在前面。比起沿着既定路线前行，你或许更喜欢亲自看看路的另一边。
              </p>
              <div className={styles.traits}>
                <span>自主探索</span>
                <span>创造表达</span>
                <span>自由行路</span>
              </div>
              <a href="#character" className={styles.textLink}>
                往下，读懂更多
                <ArrowDown size={16} aria-hidden="true" />
              </a>
            </section>
            <section id="character" className={styles.reportSection}>
              <p className={styles.eyebrow}>02 / 性情侧写</p>
              <h2>性格不止一个侧面</h2>
              <p className={styles.sectionLead}>
                四个观察角度，拼出更完整的轮廓。
              </p>
              <dl className={styles.dimensions}>
                {report.dimensions.map((d, i) => (
                  <div key={d.id}>
                    <span aria-hidden="true">0{i + 1}</span>
                    <dt>
                      {d.label}
                      <b>{tendency[d.tendency]}</b>
                    </dt>
                    <dd>{d.explanation}</dd>
                  </div>
                ))}
              </dl>
              <p className={styles.note}>
                倾向标签来自合成内容，不代表量表分数或匹配概率。
              </p>
              <details className={styles.explanation}>
                <summary>为什么用这个人物意象？</summary>
                <p>{report.rationale.summary}</p>
                {report.rationale.basis.map((b) => (
                  <p key={b.label}>
                    <strong>{b.label}：</strong>
                    {b.explanation}
                  </p>
                ))}
              </details>
            </section>
            <section id="practice" className={styles.reportSection}>
              <p className={styles.eyebrow}>03 / 相处指南</p>
              <h2>留住光，也照见另一面</h2>
              <div className={styles.practice}>
                <section>
                  <span>让你发光的地方</span>
                  <h3>给灵感一个出口</h3>
                  <ul>
                    {report.strengths.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </section>
                <section>
                  <span>可以多留意一点</span>
                  <h3>让热爱走得更远</h3>
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
              <p className={styles.eyebrow}>04 / 人物注脚</p>
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
              <h2>将心事，写成远方。</h2>
              <p>把人物、短句与性情意象，收进一张画里。</p>
              <PrimaryLink href={studyPath(direction, "poster")}>
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
}: {
  direction: Direction;
  report: HistoricalReportView;
}) {
  return (
    <StudyShell direction={direction} view="poster">
      <section className={styles.posterPage}>
        <div className={styles.posterIntro}>
          <p className={styles.eyebrow}>A MOMENT TO KEEP</p>
          <h2>收藏这一次相逢</h2>
          <p>海报视觉概念 · 固定合成示例</p>
        </div>
        <CharacterPlate direction={direction} report={report} poster />
        <div className={styles.posterCaption}>
          <p>一张人物卡，装下此刻的心意。</p>
          <p className={styles.note}>
            当前为画幅与排版预览，尚未提供图片保存。
          </p>
          <Link
            prefetch={false}
            className={styles.textLink}
            href={studyPath(direction, "report")}
          >
            回到人物志
            <ArrowUpRight size={17} aria-hidden="true" />
          </Link>
        </div>
      </section>
    </StudyShell>
  );
}
