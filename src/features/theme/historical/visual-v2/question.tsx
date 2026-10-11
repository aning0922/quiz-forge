"use client";

import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  RefreshCw,
} from "lucide-react";
import { useVisualStudy } from "@/features/quiz/use-visual-study";
import { CardBack, StudyShell, studyPath, type Direction } from "./shared";
import styles from "./visual-v2.module.css";

const chapters = [
  { name: "起念", line: "每一种开始，都藏着你的节奏。" },
  { name: "相处", line: "在人与人的相逢里，看见自己。" },
  { name: "远行", line: "走过一些风景，留下自己的答案。" },
];

export function VisualQuestion({ direction }: { direction: Direction }) {
  const flow = useVisualStudy(direction);
  const chapter = chapters[Math.floor(flow.index / 4)]!;
  const selected = flow.answers[flow.question.id];
  const journey = direction === "journey";

  return (
    <StudyShell direction={direction} view="question">
      <div className={styles.questionLayout}>
        <aside className={styles.journeyAside} aria-hidden="true">
          <span>
            循山河
            <br />
            见性情
          </span>
          <p>十二问，一次向内的旅行。</p>
        </aside>
        <div className={styles.questionBody}>
          {flow.phase === "loading" ? (
            <section className={styles.loading} role="status">
              <span className={styles.loadingMark}>卷</span>
              <h1>正在打开你的书卷</h1>
              <p>读取这台设备上的进度…</p>
            </section>
          ) : (
            <>
              {flow.notice && (
                <section className={styles.alert} role="status">
                  <strong>
                    {flow.notice === "conflict"
                      ? "另一页更新了进度"
                      : flow.corrupt
                        ? "书签暂时无法读取"
                        : "这次进度没有保存"}
                  </strong>
                  <p>
                    {flow.notice === "conflict"
                      ? "已暂停选择与前进，避免两份回答互相覆盖。"
                      : flow.corrupt
                        ? "原书签保留在本机。你可以临时作答，或明确丢弃后重新开始。"
                        : "你仍可继续作答，但离开页面后可能无法恢复。"}
                  </p>
                  <div>
                    {flow.notice === "conflict" && (
                      <>
                        <button onClick={flow.keepLocal}>使用此页草稿</button>
                        <button onClick={() => window.location.reload()}>
                          读取另一页进度
                        </button>
                      </>
                    )}
                    {flow.corrupt && (
                      <button onClick={flow.reset}>
                        丢弃损坏书签，重新开始
                      </button>
                    )}
                    {flow.notice === "save-failed" && !flow.corrupt && (
                      <button onClick={() => flow.save()}>重试保存</button>
                    )}
                  </div>
                </section>
              )}
              {flow.phase === "resume" ? (
                <section className={styles.resume}>
                  <div className={styles.bookmarkArt} aria-hidden="true">
                    <Bookmark size={34} />
                    <span>{String(flow.count).padStart(2, "0")}</span>
                  </div>
                  <p className={styles.eyebrow}>
                    {journey ? "旅程尚未结束" : "你的问笺，已妥善收起"}
                  </p>
                  <h1>
                    {journey ? (
                      <>
                        山水还在，
                        <br />
                        等你接着往前。
                      </>
                    ) : (
                      <>
                        上次的思考，
                        <br />
                        仍停在这里。
                      </>
                    )}
                  </h1>
                  <p>已答 {flow.count} / 12 题 · 进度仅在此浏览器</p>
                  <button
                    className={styles.primary}
                    onClick={flow.resume}
                    disabled={flow.locked}
                  >
                    继续上次的旅程
                    <ArrowRight size={20} aria-hidden="true" />
                  </button>
                  <details className={styles.reset}>
                    <summary>想从头开始？</summary>
                    <p>这会清除本机这一方向的回答。</p>
                    <button onClick={flow.reset}>
                      <RefreshCw size={16} aria-hidden="true" />
                      清除并重新开始
                    </button>
                  </details>
                </section>
              ) : flow.phase === "confirm" ? (
                <section className={styles.confirm}>
                  <CardBack />
                  <p className={styles.eyebrow}>十二问 · 落款之前</p>
                  <h1>
                    {flow.count === 12
                      ? "一卷问答，已走到尾声。"
                      : "还有几页，等你写下。"}
                  </h1>
                  <p>
                    {flow.count === 12
                      ? "接下来查看固定合成示例，体验人物揭晓与报告设计。它不由你的答案计算，也不会保存为正式结果。"
                      : `还有 ${12 - flow.count} 题未选择，请补齐后继续。`}
                  </p>
                  <button
                    className={styles.primary}
                    disabled={flow.locked || flow.count !== 12}
                    onClick={() => {
                      if (!flow.locked && flow.count === 12)
                        window.location.assign(studyPath(direction, "reveal"));
                    }}
                  >
                    查看合成揭晓
                    <ArrowRight size={20} aria-hidden="true" />
                  </button>
                  <button className={styles.textButton} onClick={flow.edit}>
                    返回修改回答
                  </button>
                </section>
              ) : (
                <section
                  className={styles.question}
                  aria-labelledby="v2-question"
                  data-chapter={Math.floor(flow.index / 4)}
                >
                  <div className={styles.progressMeta}>
                    <span>
                      {journey
                        ? `第${["一", "二", "三"][Math.floor(flow.index / 4)]}章 · ${chapter.name}`
                        : "风骨问笺"}
                    </span>
                    <span>
                      <b>{String(flow.index + 1).padStart(2, "0")}</b> / 12
                    </span>
                  </div>
                  <div
                    className={styles.progress}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={12}
                    aria-valuenow={flow.count}
                    aria-label="已回答题数"
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <i
                        key={i}
                        data-done={i < flow.count}
                        data-current={i === flow.index}
                      />
                    ))}
                  </div>
                  <div className={styles.questionHeading}>
                    <p className={styles.chapterLine}>{chapter.line}</p>
                    <h1 id="v2-question" tabIndex={-1}>
                      {flow.question.prompt}
                    </h1>
                    {flow.question.note && (
                      <p className={styles.longNote}>{flow.question.note}</p>
                    )}
                  </div>
                  <fieldset
                    className={styles.options}
                    role="radiogroup"
                    aria-labelledby="v2-instruction"
                  >
                    <legend id="v2-instruction">
                      凭直觉选一项，再次点击可取消
                    </legend>
                    {flow.question.options.map((option, i) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected === i}
                        disabled={flow.locked}
                        id={`v2-option-${i}`}
                        key={option}
                        onClick={() => flow.choose(i)}
                        onKeyDown={(event) => {
                          if (
                            ![
                              "ArrowDown",
                              "ArrowUp",
                              "ArrowRight",
                              "ArrowLeft",
                            ].includes(event.key)
                          )
                            return;
                          event.preventDefault();
                          const target =
                            (i +
                              (["ArrowDown", "ArrowRight"].includes(event.key)
                                ? 1
                                : -1) +
                              4) %
                            4;
                          flow.choose(target, false);
                          document
                            .getElementById(`v2-option-${target}`)
                            ?.focus();
                        }}
                      >
                        <span className={styles.optionIndex} aria-hidden="true">
                          {selected === i ? (
                            <Check size={18} />
                          ) : (
                            ["A", "B", "C", "D"][i]
                          )}
                        </span>
                        <span>{option}</span>
                      </button>
                    ))}
                  </fieldset>
                  <div className={styles.saveLine} role="status">
                    <Bookmark size={14} aria-hidden="true" />
                    {flow.corrupt
                      ? "损坏书签已保留，本次未保存"
                      : flow.locked
                        ? "请先处理进度冲突"
                        : flow.saved
                          ? "已暂存，下次可以接着答"
                          : flow.notice === "save-failed"
                            ? "暂存失败，可继续作答"
                            : "按自己的节奏来，没有标准答案"}
                  </div>
                  <div className={styles.questionActions}>
                    <button
                      className={styles.previous}
                      disabled={flow.index === 0}
                      onClick={flow.previous}
                    >
                      <ArrowLeft size={18} aria-hidden="true" />
                      上一题
                    </button>
                    <button
                      className={styles.primary}
                      disabled={!Number.isInteger(selected) || flow.locked}
                      onClick={flow.next}
                    >
                      {flow.index === 11 ? "核对答卷" : "下一题"}
                      <ArrowRight size={18} aria-hidden="true" />
                    </button>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </StudyShell>
  );
}
