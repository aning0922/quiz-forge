"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ComposedReportBodyV1 } from "@/lib/assessment-contract/composed-report-v1";
import { ArtImage, Screen, type QianzaiViewProps } from "./views";
import { qianzaiCharacter, qianzaiImage } from "./art";
import styles from "./qianzai.module.css";

const point = (index: number, radius: number) => {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / 5;
  return [
    180 + Math.cos(angle) * radius,
    166 + Math.sin(angle) * radius,
  ] as const;
};
export function QianzaiDimensions({ body }: { body: ComposedReportBodyV1 }) {
  const id = useId();
  return (
    <section className={styles.dimensionCard} aria-label="本轮五维">
      <h3>本轮选择的五个方向</h3>
      <p>分数来自同一份封存报告；50 只是刻度中点。</p>
      {body.dimensions.length === 5 && (
        <svg
          viewBox="0 0 360 330"
          role="img"
          aria-labelledby={id}
          className={styles.radar}
        >
          <title id={id}>
            {body.dimensions.map((d) => `${d.label} ${d.score}分`).join("，")}
          </title>
          {[0.25, 0.5, 0.75, 1].map((scale) => (
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
              x1={180}
              y1={166}
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
            const [x, y] = point(i, 139),
              [px, py] = point(i, (d.score / 100) * 103);
            return (
              <g key={d.dimensionRef.id}>
                <circle cx={px} cy={py} r={4} />
                <text x={x} y={y} textAnchor="middle">
                  <tspan x={x}>{d.label}</tspan>
                  <tspan x={x} dy={23}>
                    {d.score}
                  </tspan>
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <dl className={styles.dimensionBars}>
        {body.dimensions.map((d) => (
          <div key={d.dimensionRef.id}>
            <dt>{d.label}</dt>
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
      <div className={styles.scaleLegend} aria-hidden="true">
        <span>0</span>
        <span>50</span>
        <span>100</span>
      </div>
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
    <details className={styles.evidence} data-counter={counter}>
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
export function QianzaiReport({
  model,
  onRead,
  onEvent,
  images,
}: QianzaiViewProps) {
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
  const [reading, setReading] = useState({ percent: 0, chapter: "开卷" });
  const measure = (node: HTMLDivElement) => {
    const max = Math.max(0, node.scrollHeight - node.clientHeight);
    const percent = max
      ? Math.round(Math.min(1, Math.max(0, node.scrollTop / max)) * 100)
      : 100;
    let chapter = "开卷";
    const threshold = node.getBoundingClientRect().top + 160;
    for (const section of node.querySelectorAll<HTMLElement>(
      "[data-report-chapter]",
    ))
      if (section.getBoundingClientRect().top <= threshold)
        chapter = section.dataset.reportChapter ?? chapter;
    setReading((old) =>
      old.percent === percent && old.chapter === chapter
        ? old
        : { percent, chapter },
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
  return (
    <Screen name="report" className={styles.reportScreen}>
      <div
        ref={container}
        className={styles.reportScroll}
        onScroll={(e) => measure(e.currentTarget)}
      >
        <div>
          <header className={styles.reportNav} data-paper={reading.percent > 3}>
            <div>
              <button onClick={() => onRead("result")}>相逢</button>
              <span>
                千载同心<strong>人物长卷</strong>
              </span>
              <details className={styles.contents}>
                <summary>六卷目录</summary>
                <nav aria-label="六卷目录">
                  {body?.volumes.map((v, i) => (
                    <a key={v.id} href={`#${id}-${v.id}`}>
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
              <p>千载之间 · 同心之人</p>
              <h1>{body?.matching.selected.label ?? "人物长卷"}</h1>
              <p>循着本轮选择，展开六卷相逢。</p>
            </div>
          </div>
          <main
            className={styles.reportPaper}
            style={
              paper
                ? { backgroundImage: `url("${paper.objectUrl}")` }
                : undefined
            }
          >
            {body && (
              <>
                <section className={styles.reportOpening}>
                  <p className={styles.eyebrow}>命定相逢 · 本轮记录</p>
                  <h2>{body.title}</h2>
                  <p className={styles.reportIndex}>
                    契合指数{" "}
                    <strong>{body.matching.selected.narrativeIndex}</strong> /
                    100
                  </p>
                  <p>{body.notice}</p>
                  <p>
                    {body.matching.selected.kind === "literary-legendary"
                      ? "木兰以文学／传说人物的艺术形象参与本轮匹配。"
                      : "人物为文学类比，不是历史人物心理测量。"}
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
                  <article
                    key={v.id}
                    id={`${id}-${v.id}`}
                    className={styles.volume}
                    data-report-chapter={v.title}
                  >
                    <header>
                      <p>第{["一", "二", "三", "四", "五", "六"][i]}卷</p>
                      <h2>{v.title}</h2>
                    </header>
                    {v.id === "dimensions" && <QianzaiDimensions body={body} />}
                    {v.paragraphs.map((p, j) => (
                      <section key={j} className={styles.paragraph}>
                        <p className={styles.qualifier}>
                          {p.status === "facts-only"
                            ? "本轮事实"
                            : p.status === "fallback"
                              ? "证据不足时的说明"
                              : "有证据支持的限定描述"}{" "}
                          · {p.kind === "literary" ? "文学类比" : "本轮情境"}
                        </p>
                        <p>{p.text}</p>
                        <Evidence entries={p.evidence} />
                        <Evidence entries={p.counterevidence} counter />
                      </section>
                    ))}
                  </article>
                ))}
                <details className={styles.allAnswers}>
                  <summary>本轮全部选择 · {body.answers.length} 题</summary>
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
                <footer className={styles.reportClosing}>
                  <p>千载相逢，始于此刻的你。</p>
                  <p>{body.notice}</p>
                  <button onClick={() => onRead("result")}>回望相逢</button>
                </footer>
              </>
            )}
          </main>
        </div>
      </div>
    </Screen>
  );
}
