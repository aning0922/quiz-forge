import Link from "next/link";
import type { HistoricalReportView } from "@/features/report/historical-view";
import { Character } from "../character";
import { Seal, ScrollRule } from "../ornaments";
import { findConceptPortrait } from "./tokens";
import { SelectedHistoricalShell } from "./shell";
import styles from "./selected.module.css";

const tendencies = {
  prominent: "较突出",
  balanced: "较均衡",
  reserved: "较内敛",
} as const;

function ReportSection({
  id,
  number,
  title,
  children,
}: {
  id: string;
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={styles.reportSection}>
      <div className={styles.sectionTitle}>
        <span>{number}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

/** Receives a read-only view. No scores are computed and no completion is granted. */
export function SelectedHistoricalResult({
  report,
}: {
  report: HistoricalReportView;
}) {
  const identity = report.identity;
  return (
    <SelectedHistoricalShell state="result">
      <p className={styles.resultDisclosure}>
        合成展示 · 非真实测评结果 · 所有倾向与人物关系均为演示
      </p>
      <div className={styles.resultLayout}>
        <section className={styles.reveal} aria-label="匹配人物与称号">
          <p className={styles.revealKicker}>人物揭晓 / 合成示例</p>
          <div className={styles.collectionCard}>
            <div className={styles.aureole} aria-hidden="true" />
            <Character
              className={styles.resultPortrait ?? ""}
              asset={findConceptPortrait(identity.portraitAssetId)}
            />
            <div className={styles.identity}>
              <span>{identity.era}</span>
              <h1>{identity.name}</h1>
              <Seal>
                风<br />骨
              </Seal>
            </div>
            <span className={styles.cardSerial}>概念卡 · 壹</span>
            <div className={styles.cardTitle}>
              <p>{identity.title}</p>
              <span>艺术化形象 · 素材待审</span>
            </div>
          </div>
          <p className={styles.resultShortLine}>{identity.shortLine}</p>
          <Link className={styles.revealLink} href="#report">
            展开人物志长卷 <span aria-hidden="true">↓</span>
          </Link>
          <p className={styles.revealNote}>
            具体人物仅在揭晓区域出现。
            <br />
            当前为研究用合成示例，无答题与评分。
          </p>
        </section>
        <article
          id="report"
          className={styles.report}
          aria-label="人物志详细报告"
        >
          <div className={styles.scrollHeading}>
            <p className={styles.kicker}>风骨卷 · 合成档案</p>
            <h2>读懂这份性情</h2>
            <p>不是给你下定义，而是提供一种观察自己的角度。</p>
          </div>
          <ScrollRule />
          <ReportSection id="dimensions" number="壹" title="核心性格维度">
            <p className={styles.note}>
              以下为合成倾向标签，不是分数、概率或心理量表。
            </p>
            <dl className={styles.dimensions}>
              {report.dimensions.map((d) => (
                <div key={d.id}>
                  <dt>
                    {d.label}
                    <span>{tendencies[d.tendency]}</span>
                  </dt>
                  <dd>{d.explanation}</dd>
                </div>
              ))}
            </dl>
          </ReportSection>
          <ReportSection id="rationale" number="贰" title="匹配依据">
            <p>{report.rationale.summary}</p>
            <dl className={styles.rationale}>
              {report.rationale.basis.map((b) => (
                <div key={b.label}>
                  <dt>{b.label}</dt>
                  <dd>{b.explanation}</dd>
                </div>
              ))}
            </dl>
            <p className={styles.note}>
              此处未引用真实回答；未来只展示确定性结果的可核实依据。
            </p>
          </ReportSection>
          <ReportSection id="strengths" number="叁" title="主要优势与潜在短板">
            <div className={styles.strengths}>
              <section>
                <h3>让你发光的地方</h3>
                <ul>
                  {report.strengths.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </section>
              <section>
                <h3>可以多留意一点</h3>
                <ul>
                  {report.tradeoffs.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </section>
            </div>
            <p className={styles.note}>
              倾向不是好坏评判，也不决定你的能力或选择。
            </p>
          </ReportSection>
          <ReportSection id="similar" number="肆" title="其他相似人物">
            <p className={styles.note}>合成比较关系，没有排名与匹配百分比。</p>
            <div className={styles.similar}>
              {report.similarPeople.length ? (
                report.similarPeople.map((p) => (
                  <div key={p.name}>
                    <h3>{p.name}</h3>
                    <p>{p.reason}</p>
                  </div>
                ))
              ) : (
                <p>暂无相似人物资料，不补造比较关系。</p>
              )}
            </div>
          </ReportSection>
          <ReportSection id="culture" number="伍" title="文化人物介绍">
            <aside className={styles.culture}>
              <h3>{report.culture.heading}</h3>
              <p>{report.culture.text}</p>
              <p className={styles.note}>
                介绍来源与史实审读待补齐；文化介绍与性格解释分开。
              </p>
            </aside>
          </ReportSection>
          <ReportSection id="poster" number="陆" title="收藏海报信息">
            <div className={styles.posterSummary}>
              <p className={styles.kicker}>人物卡 / 静态信息槽位</p>
              <h3>{report.poster.title}</h3>
              <p className={styles.posterLine}>{report.poster.shortLine}</p>
              <p>{report.poster.attribution}</p>
              <p className={styles.note}>{report.poster.disclosure}</p>
            </div>
            <p className={styles.note}>
              仅展示海报字段，不是海报成品。画幅、导出和保存流程待 D1-C。
            </p>
          </ReportSection>
          <div className={styles.reportEnd}>
            <ScrollRule />
            <p>
              娱乐与自我探索，不作为心理诊断。
              <br />
              你始终可以用自己的方式，重新书写自己。
            </p>
            <Link
              href="/studies/historical/selected/cover"
              className={styles.outlineLink}
            >
              返回未揭晓封面
            </Link>
          </div>
        </article>
      </div>
    </SelectedHistoricalShell>
  );
}
