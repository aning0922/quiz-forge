"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronDown, ArrowUp } from "lucide-react";
import type { ComposedReportBodyV1 } from "@/lib/assessment-contract/composed-report-v1";
import { ArtImage, Screen, type QianzaiViewProps } from "./views";
import { qianzaiCharacter, qianzaiImage } from "./art";
import styles from "./qianzai.module.css";

const point = (index: number, radius: number) => {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / 5;
  return [
    170 + Math.cos(angle) * radius,
    167 + Math.sin(angle) * radius,
  ] as const;
};
export function QianzaiDimensions({ body }: { body: ComposedReportBodyV1 }) {
  const id = useId();
  const [selected, setSelected] = useState<number | null>(null);
  const reading = useRef<HTMLDetailsElement>(null);
  const dimension = body.dimensions[selected ?? 0];
  const select = (index: number) => {
    setSelected(index);
    if (reading.current) reading.current.open = true;
  };
  return (
    <section className={styles.dimensionCard} aria-label="本轮五维">
      <div className={styles.dimensionHeading}>
        <h3>同心画像</h3>
        <span>封存分值</span>
      </div>
      {body.dimensions.length === 5 && (
        <svg
          viewBox="0 0 340 348"
          role="group"
          aria-labelledby={id}
          className={styles.radar}
        >
          <title id={id}>
            {body.dimensions.map((d) => `${d.label} ${d.score}分`).join("，")}
          </title>
          {[0.2, 0.4, 0.6, 0.8, 1].map((scale) => (
            <polygon
              key={scale}
              points={Array.from({ length: 5 }, (_, i) =>
                point(i, scale * 103).join(","),
              ).join(" ")}
              className={styles.radarRing}
            />
          ))}
          {body.dimensions.map((d, i) => (
            <line
              key={d.dimensionRef.id}
              x1={170}
              y1={167}
              x2={point(i, 103)[0]}
              y2={point(i, 103)[1]}
              className={styles.radarAxis}
            />
          ))}
          <polygon
            points={body.dimensions
              .map((d, i) => point(i, (d.score / 100) * 103).join(","))
              .join(" ")}
            className={styles.radarShape}
          />
          {body.dimensions.map((d, i) => {
            const [x, y] = [
                [170, 26],
                [290, 112],
                [281, 298],
                [59, 298],
                [50, 112],
              ][i]!,
              [px, py] = point(i, (d.score / 100) * 103);
            return (
              <g key={d.dimensionRef.id}>
                <circle
                  cx={px}
                  cy={py}
                  r={selected === i ? 6 : 4}
                  data-qianzai-radar-point={d.dimensionRef.id}
                  className={styles.radarPoint}
                  aria-hidden="true"
                  onClick={() => select(i)}
                />
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`${d.label} ${d.score}分`}
                  aria-pressed={selected === i}
                  className={styles.radarNode}
                  onClick={() => select(i)}
                  onKeyDown={(event) => {
                    if (["Enter", " "].includes(event.key)) {
                      event.preventDefault();
                      select(i);
                    }
                  }}
                >
                  <circle cx={x} cy={y} r={29} className={styles.radarHit} />
                  <text x={x} y={y} textAnchor="middle">
                    <tspan x={x}>{d.label}</tspan>
                    <tspan x={x} dy={23}>
                      {d.score}
                    </tspan>
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
      )}
      <details ref={reading} className={styles.dimensionDetails}>
        <summary>查看五维分值与选择依据</summary>
        <dl className={styles.dimensionBars}>
          {body.dimensions.map((d, i) => (
            <div key={d.dimensionRef.id} data-selected={selected === i}>
              <dt>
                <button aria-pressed={selected === i} onClick={() => select(i)}>
                  {d.label}
                </button>
              </dt>
              <dd>
                <span className={styles.dualBar} aria-hidden="true">
                  <i
                    style={{
                      left: `${Math.min(50, d.score)}%`,
                      width: `${Math.abs(d.score - 50)}%`,
                    }}
                  />
                  <b style={{ left: `${d.score}%` }} />
                </span>
                <span className={styles.numericScore}>{d.score} / 100</span>
              </dd>
            </div>
          ))}
        </dl>
        {dimension && (
          <aside className={styles.dimensionReading} aria-live="polite">
            <h4>
              {dimension.label} · {dimension.score} / 100
            </h4>
            <p>这是本轮选择的一个方向，不是能力等级。</p>
            <button
              onClick={(event) => {
                const evidence = event.currentTarget
                  .closest("article")
                  ?.querySelector<HTMLDetailsElement>(
                    "details[data-report-evidence]",
                  );
                if (evidence) {
                  evidence.open = true;
                  evidence
                    .querySelector("summary")
                    ?.focus({ preventScroll: true });
                  evidence.scrollIntoView({
                    block: "center",
                    behavior: window.matchMedia(
                      "(prefers-reduced-motion: reduce)",
                    ).matches
                      ? "instant"
                      : "smooth",
                  });
                }
              }}
            >
              阅读本卷选择依据
            </button>
          </aside>
        )}
        <div className={styles.scaleLegend} aria-hidden="true">
          <span>0</span>
          <span>50</span>
          <span>100</span>
        </div>
        <p className={styles.dimensionNote}>
          分数来自同一份封存报告；50 只是刻度中点。
        </p>
      </details>
    </section>
  );
}
function Evidence({
  entries,
  counter = false,
}: {
  entries: ComposedReportBodyV1["volumes"][number]["paragraphs"][number]["evidence"];
  counter?: boolean;
}) {
  return entries.length ? (
    <details
      className={styles.evidence}
      data-report-evidence
      data-counter={counter}
    >
      <summary>
        {counter ? "同时阅读的反向证据" : "本段依据的实际选择"} ·{" "}
        {entries.length}
      </summary>
      <ul>
        {entries.map((e, i) => (
          <li key={`${e.questionRef.id}:${e.optionRef.id}:${i}`}>
            <p>{e.prompt}</p>
            <blockquote>{e.optionText}</blockquote>
            <p className={styles.evidenceScope}>{e.scope}</p>
          </li>
        ))}
      </ul>
    </details>
  ) : null;
}
function ReportParagraph({
  paragraph,
}: {
  paragraph: ComposedReportBodyV1["volumes"][number]["paragraphs"][number];
}) {
  return (
    <section
      className={styles.paragraph}
      data-kind={paragraph.kind}
      data-status={paragraph.status}
    >
      <p>{paragraph.text}</p>
      <p
        className={`${styles.qualifier} ${paragraph.status === "accepted" ? styles.srOnly : ""}`}
      >
        {paragraph.status === "facts-only"
          ? "本轮事实"
          : paragraph.status === "fallback"
            ? "证据不足时的说明"
            : "有证据支持的限定描述"}{" "}
        · {paragraph.kind === "literary" ? "文学类比" : "本轮情境"}
      </p>
      <Evidence entries={paragraph.evidence} />
      <Evidence entries={paragraph.counterevidence} counter />
    </section>
  );
}
export function QianzaiReport({
  model,
  onRead,
  onEvent,
  images,
  entry = 0,
  active = true,
}: QianzaiViewProps & { entry?: number; active?: boolean }) {
  const body = model.report?.view.display.body,
    character = qianzaiCharacter(model);
  const hero = qianzaiImage(model, character?.report, images),
    paper = qianzaiImage(
      model,
      model.report?.view.display.slots.neutral.reportPaper,
      images,
    );
  const id = useId(),
    container = useRef<HTMLDivElement>(null);
  const [reading, setReading] = useState({
    percent: 0,
    chapter: "卷首 · 相逢",
    paper: false,
  });
  const measure = (node: HTMLDivElement) => {
    const max = Math.max(0, node.scrollHeight - node.clientHeight);
    const percent = max
      ? Math.round(Math.min(1, Math.max(0, node.scrollTop / max)) * 100)
      : 100;
    let chapter = "卷首 · 相逢";
    const threshold = node.getBoundingClientRect().top + 160;
    for (const section of node.querySelectorAll<HTMLElement>(
      "[data-report-chapter]",
    ))
      if (section.getBoundingClientRect().top <= threshold)
        chapter = section.dataset.reportChapter ?? chapter;
    const paper = node.scrollTop > 210;
    setReading((old) =>
      old.percent === percent && old.chapter === chapter && old.paper === paper
        ? old
        : { percent, chapter, paper },
    );
  };
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(() => measure(node));
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (active && container.current) {
      container.current.scrollTop = 0;
      measure(container.current);
    }
    // Opening the paper from the reveal starts at the beginning, as in the
    // original reader. Resource/font completion never resets a reading position.
  }, [entry, active]);
  const returnToStart = () => {
    container.current?.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    container.current
      ?.querySelector<HTMLElement>("[data-report-opening-title]")
      ?.focus({ preventScroll: true });
  };
  return (
    <Screen name="report" className={styles.reportScreen}>
      <div
        ref={container}
        className={styles.reportScroll}
        onScroll={(e) => measure(e.currentTarget)}
      >
        <div>
          <header className={styles.reportNav} data-paper={reading.paper}>
            <div>
              <button
                className={styles.reportBack}
                onClick={() => onRead("result")}
                aria-label="返回人物揭晓"
              >
                <ChevronLeft size={24} aria-hidden="true" />
              </button>
              <span>
                千载同心<strong>人物深度报告</strong>
              </span>
              <details className={styles.contents}>
                <summary>
                  卷目 <ChevronDown size={15} aria-hidden="true" />
                </summary>
                <nav aria-label="六卷目录">
                  <p className={styles.contentsHeading}>此卷共六章</p>
                  {body?.volumes.map((v, i) => (
                    <a
                      key={v.id}
                      href={`#${id}-${v.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        const target =
                          container.current?.querySelector<HTMLElement>(
                            `[data-report-chapter-id="${v.id}"]`,
                          );
                        target?.scrollIntoView({
                          block: "start",
                          behavior: window.matchMedia(
                            "(prefers-reduced-motion: reduce)",
                          ).matches
                            ? "instant"
                            : "smooth",
                        });
                        event.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                        target
                          ?.querySelector<HTMLElement>("h1,h2")
                          ?.focus({ preventScroll: true });
                      }}
                    >
                      卷{["一", "二", "三", "四", "五", "六"][i]} · {v.title}
                    </a>
                  ))}
                  <button onClick={() => onEvent({ type: "logout" })}>
                    结束本次访问
                  </button>
                </nav>
              </details>
            </div>
            <p>
              <span>{reading.chapter}</span>
              <span>{reading.percent}%</span>
            </p>
            <div
              className={styles.readingTrack}
              role="progressbar"
              aria-label="长卷阅读进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={reading.percent}
            >
              <i style={{ width: `${reading.percent}%` }} />
            </div>
          </header>
          <div className={styles.reportHero}>
            <ArtImage
              key={hero?.objectUrl ?? "none"}
              src={hero?.objectUrl}
              className={styles.fullArt}
            />
            <div>
              {!hero && (
                <p className={styles.reportArtPending}>人物画作待接入</p>
              )}
              <p className={styles.reportHeroKicker}>一卷山河 · 因你而展</p>
              <p>循着本轮选择，展开六卷相逢。</p>
            </div>
          </div>
          <main
            className={styles.reportPaper}
            style={
              paper
                ? {
                    backgroundImage: `linear-gradient(180deg, rgba(255,252,243,.97), rgba(251,240,218,.96) 23%, rgba(248,235,208,.98)), url("${paper.objectUrl}")`,
                  }
                : undefined
            }
          >
            {body && (
              <>
                <section
                  className={styles.reportOpening}
                  data-report-chapter-id="encounter"
                >
                  <p className={styles.eyebrow}>
                    <span aria-hidden="true">✧</span> 命定相逢 · 本轮记录{" "}
                    <span aria-hidden="true">✧</span>
                  </p>
                  <h1 data-report-opening-title tabIndex={-1}>
                    {body.matching.selected.label}
                  </h1>
                  <p className={styles.reportSubtitle}>{body.title}</p>
                  <p className={styles.reportIndex}>
                    契合指数{" "}
                    <strong>{body.matching.selected.narrativeIndex}</strong> /
                    100
                  </p>
                  {body.matching.status !== "single-candidate" &&
                    body.matching.runnerUp && (
                      <p>
                        {body.matching.status === "near-tie"
                          ? "前两位接近。"
                          : "本轮第二候选："}
                        {body.matching.runnerUp.label} · 契合指数{" "}
                        {body.matching.runnerUp.narrativeIndex} / 100
                      </p>
                    )}
                </section>
                {body.volumes.map((v, i) => (
                  <Fragment key={v.id}>
                    {v.id === "closure" && (
                      <details className={styles.allAnswers}>
                        <summary>
                          本轮全部选择 · {body.answers.length} 题
                        </summary>
                        <ol>
                          {body.answers.map((a) => (
                            <li key={a.questionRef.id}>
                              <p>
                                第 {a.act} 幕 · {a.prompt}
                              </p>
                              <blockquote>{a.optionText}</blockquote>
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}
                    <article
                      id={`${id}-${v.id}`}
                      className={styles.volume}
                      data-volume={v.id}
                      data-report-chapter={v.title}
                      data-report-chapter-id={
                        v.id === "encounter" ? undefined : v.id
                      }
                    >
                      <header>
                        <p>第{["一", "二", "三", "四", "五", "六"][i]}卷</p>
                        <h2 tabIndex={-1}>{v.title}</h2>
                      </header>
                      {v.id === "dimensions" && (
                        <QianzaiDimensions body={body} />
                      )}
                      {v.id === "counterevidence" ? (
                        <>
                          <div className={styles.reflectionFeature}>
                            {v.paragraphs.slice(0, 2).map((paragraph, j) => (
                              <ReportParagraph key={j} paragraph={paragraph} />
                            ))}
                          </div>
                          {v.paragraphs.length > 2 && (
                            <div className={styles.reflectionNotes}>
                              {v.paragraphs.slice(2).map((paragraph, j) => (
                                <ReportParagraph
                                  key={j}
                                  paragraph={paragraph}
                                />
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        v.paragraphs.map((paragraph, j) => (
                          <ReportParagraph key={j} paragraph={paragraph} />
                        ))
                      )}
                      {v.id === "encounter" && (
                        <div className={styles.reportNotices}>
                          <p className={styles.reportNotice}>{body.notice}</p>
                          {body.matching.status === "single-candidate" && (
                            <p className={styles.reportKind}>
                              本轮偏好下仅有一位候选人物。
                            </p>
                          )}
                          <p className={styles.reportKind}>
                            {body.matching.selected.kind ===
                            "literary-legendary"
                              ? `${body.matching.selected.label}以文学／传说人物的艺术形象参与本轮匹配。`
                              : "人物为文学类比，不是历史人物心理测量。"}
                          </p>
                        </div>
                      )}
                      {v.id === "closure" && (
                        <footer className={styles.reportClosing}>
                          <div
                            className={styles.closingOrnament}
                            aria-hidden="true"
                          >
                            ✧　✦　✧
                          </div>
                          <div className={styles.finalStamp} aria-hidden="true">
                            千载
                            <br />
                            同心
                          </div>
                          <p className={styles.reportEndline}>长卷已展至尽处</p>
                          <div className={styles.reportActions}>
                            <button
                              disabled
                              aria-describedby={`${id}-poster-note`}
                            >
                              分享卡待开放
                            </button>
                            <button onClick={() => onRead("result")}>
                              回看人物揭晓
                            </button>
                          </div>
                          <p
                            id={`${id}-poster-note`}
                            className={styles.posterNote}
                          >
                            分享卡与图片导出尚未开放。
                          </p>
                          <button
                            className={styles.returnToStart}
                            onClick={returnToStart}
                          >
                            <ArrowUp size={16} aria-hidden="true" />
                            回到卷首
                          </button>
                          <p>{body.notice}</p>
                        </footer>
                      )}
                    </article>
                  </Fragment>
                ))}
              </>
            )}
          </main>
        </div>
      </div>
    </Screen>
  );
}
