import {
  inscriptionAttribution,
  validateInscription,
  type TemperamentInscription,
} from "@/features/report/temperament-inscription";
import type { Direction } from "./shared";
import styles from "./result-atlas.module.css";

export function TemperamentInscriptionView({
  inscription,
  direction,
}: {
  inscription: TemperamentInscription | null;
  direction: Direction;
}) {
  if (!inscription) return null;
  if (!validateInscription(inscription))
    return <p role="status">性情题签资料待补齐，暂不展示。</p>;
  return (
    <aside
      className={`${styles.inscription} ${direction === "journey" ? styles.versePaper : styles.verseArchive}`}
      aria-label="性情题签"
      data-inscription={inscription.kind}
    >
      <div className={styles.verseLabel}>
        <span>性情题签</span>
        <small>
          {inscription.kind === "classical"
            ? "古诗节选"
            : direction === "collection"
              ? "原创拟古"
              : "原创拟古 · 非古诗引用"}
        </small>
      </div>
      <blockquote>
        <p>
          {inscription.lines[0]}
          <br />
          {inscription.lines[1]}
        </p>
      </blockquote>
      <details className={styles.verseDetails}>
        <summary>
          {inscriptionAttribution(inscription)}
          <span>
            {inscription.kind === "classical"
              ? "解读与出处"
              : "非古诗引用 · 解读"}
          </span>
        </summary>
        <p>{inscription.interpretation}</p>
        {inscription.kind === "classical" ? (
          <a href={inscription.source.url} target="_blank" rel="noreferrer">
            来源：{inscription.source.title} ↗
          </a>
        ) : (
          <p>项目原创拟古题句，AI草拟，内容待人工审阅。</p>
        )}
        <p className={styles.verseStudyNote}>
          固定题签示例，未按答题或分数动态选择。
        </p>
      </details>
    </aside>
  );
}
