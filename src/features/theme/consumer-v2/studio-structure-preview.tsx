"use client";
import { useId } from "react";
import type {
  DisplayEntryBodyV2,
  ResultDisplaySnapshotV2,
} from "@/lib/assessment-contract/display-v2";
import type { MatchingContextV1 } from "@/lib/assessment-contract/matching-v1";
import { StructuredReportContentV2 } from "./components";
import styles from "./consumer.module.css";

export type StudioStructurePreviewV2Props = Readonly<{
  revision: number;
  entry: DisplayEntryBodyV2 | null;
  result: ResultDisplaySnapshotV2 | null;
  answers: readonly { questionId: string; optionId: string }[];
  matchingContext: MatchingContextV1 | null;
  busy: boolean;
  disabled: boolean;
  message: string | null;
  onAnswer(questionId: string, optionId: string): void;
  onPreference(preference: MatchingContextV1["preference"]): void;
  onScore(): void;
}>;

/** Authenticated Studio owner supplies a temporary projection for an exact draft revision.
 * This view never invents a consumer session, access key, completion receipt or persisted report. */
export function StudioStructurePreviewV2(props: StudioStructurePreviewV2Props) {
  const id = useId();
  const { entry, result } = props;
  const compatible = [entry, result].every(
    (display) =>
      !display ||
      (display.presentationMode === "structured-only" &&
        !display.exports.posterPng &&
        !display.exports.fullReportPng),
  );
  const disabled = props.disabled || props.busy || !compatible;
  const complete =
    !!entry &&
    !!props.matchingContext &&
    entry.questions.every((question) =>
      props.answers.some(
        (answer) =>
          answer.questionId === question.ref.id &&
          question.options.some((option) => option.ref.id === answer.optionId),
      ),
    );
  return (
    <section
      className={styles.preview}
      aria-label="固定修订结构预览"
      aria-busy={props.busy}
    >
      <header className={styles.banner}>
        <h2>固定修订结构预览 · 修订 {props.revision}</h2>
        <p>
          用于内部内容检查。本次结果是临时预览，不会完成消费者测评或生成已封存报告。
        </p>
      </header>
      {props.message && <p role="status">{props.message}</p>}
      {!compatible ? (
        <p role="alert">当前呈现版本不支持此结构预览。</p>
      ) : (
        <>
          {entry && (
            <div className={styles.panel}>
              <h3>{entry.product.title}</h3>
              <fieldset disabled={disabled}>
                <legend>目标人物偏好</legend>
                {entry.preferences.map((preference) => (
                  <label key={preference} className={styles.option}>
                    <input
                      type="radio"
                      name={`${id}-preference`}
                      checked={props.matchingContext?.preference === preference}
                      onChange={() => {
                        if (!disabled) props.onPreference(preference);
                      }}
                    />
                    <span>
                      {
                        {
                          male: "男性人物",
                          female: "女性人物",
                          any: "不限人物",
                        }[preference]
                      }
                    </span>
                  </label>
                ))}
              </fieldset>
              {entry.questions.map((question, index) => (
                <fieldset
                  key={question.ref.id}
                  disabled={disabled}
                  className={styles.volume}
                >
                  <legend>
                    第 {index + 1} 题 · {question.prompt}
                  </legend>
                  {question.options.map((option) => (
                    <label key={option.ref.id} className={styles.option}>
                      <input
                        type="radio"
                        name={`${id}-${question.ref.id}`}
                        checked={props.answers.some(
                          (answer) =>
                            answer.questionId === question.ref.id &&
                            answer.optionId === option.ref.id,
                        )}
                        onChange={() => {
                          if (!disabled)
                            props.onAnswer(question.ref.id, option.ref.id);
                        }}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
              <button
                disabled={disabled || !complete}
                onClick={() => {
                  if (!disabled && complete) props.onScore();
                }}
              >
                查看临时预览结果
              </button>
            </div>
          )}
          {result && (
            <section className={styles.panel} aria-label="临时预览结果">
              <h3>{result.body.title}</h3>
              <p>修订 {props.revision} 的临时结果 · 不提供 PNG 导出</p>
              <StructuredReportContentV2 body={result.body} />
            </section>
          )}
        </>
      )}
    </section>
  );
}
