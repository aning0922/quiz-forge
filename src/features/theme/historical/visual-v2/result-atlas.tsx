import type { CSSProperties } from "react";
import {
  prepareResultAtlas,
  type ResultAtlasView,
} from "@/features/report/result-atlas";
import type { Direction } from "./shared";
import styles from "./result-atlas.module.css";

export function ResultAtlas({
  atlas,
  direction,
}: {
  atlas: ResultAtlasView;
  direction: Direction;
}) {
  let dimensions;
  try {
    dimensions = prepareResultAtlas(atlas);
  } catch {
    return (
      <section className={styles.unavailable} role="status" data-atlas-error>
        <h2>性情图谱暂不可用</h2>
        <p>展示数据不完整，本次不显示分数。你仍可阅读其余人物志。</p>
      </section>
    );
  }
  return (
    <section
      id="character"
      className={`${styles.atlas} ${direction === "journey" ? styles.ink : styles.archive}`}
      aria-labelledby="atlas-title"
      data-result-atlas
      data-kind={atlas.kind}
    >
      <header className={styles.heading}>
        <div>
          <p className={styles.kicker}>
            {direction === "journey"
              ? "性情有度 / THE INNER ATLAS"
              : "人物属性档案 / ATTRIBUTE RECORD"}
          </p>
          <h2 id="atlas-title">性情图谱</h2>
        </div>
        <span className={styles.count}>
          {String(dimensions.length).padStart(2, "0")}
          <small>个侧面</small>
        </span>
      </header>
      <p className={styles.disclosure}>
        <b>SYNTHETIC · 固定模拟分数</b>
        <span>不来自当前12道题，非人格测量。</span>
      </p>
      <p className={styles.readingKey}>两端不分优劣；数值越高越靠右端。</p>
      <ol className={styles.rows}>
        {dimensions.map((dimension, index) => (
          <li
            key={dimension.dimensionId}
            className={styles.row}
            data-dimension-id={dimension.dimensionId}
          >
            <div className={styles.rowHeading}>
              <span className={styles.ordinal} aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 id={`dimension-${dimension.dimensionId}`}>
                {dimension.label}
              </h3>
              <p className={styles.score}>
                <strong>{dimension.normalizedScore}</strong>
                <span>/ 100</span>
              </p>
            </div>
            <div
              className={styles.gauge}
              role="meter"
              aria-labelledby={`dimension-${dimension.dimensionId}`}
              aria-valuenow={dimension.normalizedScore}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={`${dimension.normalizedScore} / 100，合成示意。${dimension.scaleDescription}`}
              aria-describedby={`interpretation-${dimension.dimensionId}`}
              style={
                {
                  "--dimension-score": `${dimension.normalizedScore}%`,
                } as CSSProperties
              }
            >
              <span className={styles.fill} aria-hidden="true" />
              <span className={styles.ticks} aria-hidden="true" />
            </div>
            <div className={styles.poles} aria-hidden="true">
              <span>
                <i>0</i>
                {dimension.lowLabel}
              </span>
              <span>
                {dimension.highLabel}
                <i>100</i>
              </span>
            </div>
            <p
              className={styles.interpretation}
              id={`interpretation-${dimension.dimensionId}`}
            >
              {dimension.interpretation}
            </p>
          </li>
        ))}
      </ol>
      <details className={styles.scaleNotes}>
        <summary>每把尺，分别读什么？</summary>
        <p>刻度不是百分位或人物匹配概率。</p>
        <dl>
          {dimensions.map((d) => (
            <div key={d.dimensionId}>
              <dt>{d.label}</dt>
              <dd>{d.scaleDescription}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
