"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ConsumerExperiencePropsV2,
  ConsumerReadingPageV2,
} from "../consumer-v2/interfaces";
import {
  canEditConsumerV2,
  consumerDraftStatusV2,
} from "../consumer-v2/components";
import {
  QianzaiCover,
  QianzaiPreference,
  QianzaiQuestion,
  QianzaiReveal,
  Screen,
} from "./views";
import { QianzaiReport } from "./report";
import type { QianzaiVisualProps } from "./art";
import { useQianzaiMotion } from "./motion";
import styles from "./qianzai.module.css";

export type QianzaiTongxinExperienceProps = ConsumerExperiencePropsV2 &
  QianzaiVisualProps;
const messages = {
  loading: "正在展开本轮旅程…",
  ready: "",
  saving: "正在保存这一步，请稍候。",
  completing: "正在读取本轮相逢，请保留此页。",
  unknown: "这一步的结果暂未确认，你的选择仍保留。",
  conflict: "已读到服务器处理结果，请核对后再继续。你在本页的选择仍保留。",
  completed: "",
  denied: "本次访问已结束，请重新验证。",
  unavailable: "暂时未能读取，请保留本页。",
};
/** Reading location comes only from the owner's verified accepted state.
 * A local draft/pending write is never evidence of a saved preference/position.
 */
export function qianzaiResumeQuestion(
  model: QianzaiTongxinExperienceProps["model"],
) {
  const state = model.state,
    questions = model.entry?.questions;
  if (!state?.lastSave || !state.matchingContext || !questions?.length)
    return undefined;
  const id = state.progress.questionId ?? questions[0]!.ref.id;
  return questions.some((q) => q.ref.id === id) ? id : undefined;
}
/** Unregistered D3 renderer. The compiled registry/authorized resource owner is
 * integrated separately by the coordinator. IO, CAS and original pending identity
 * remain exclusively in ConsumerControllerV2; timers below only present a click.
 */
export function QianzaiTongxinExperience({
  model,
  onEvent,
  initialScreen,
  images,
}: QianzaiTongxinExperienceProps) {
  const [page, setPage] = useState<ConsumerReadingPageV2 | null>(
    initialScreen ?? null,
  );
  const resumeQuestion = qianzaiResumeQuestion(model);
  const defaultPage = resumeQuestion ? "question" : "cover";
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    queued = useRef(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const enabled = canEditConsumerV2(model);
  const motion = useQianzaiMotion();
  const compatible =
    (model.report?.view.display.presentationMode ??
      model.entry?.presentationMode) === "authored-product";
  const active = model.report
    ? page === "report"
      ? "report"
      : "result"
    : page === "report"
      ? defaultPage
      : (page ?? defaultPage);
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    queued.current = false;
  };
  useEffect(() => {
    if (model.phase !== "ready") {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    }
    // No automatic action follows a receipt/recovery. The original controller
    // alone adopts its saved target; this merely allows a fresh explicit click.
    queued.current = false;
  }, [model.phase, model.draft?.progress.questionId]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const read = (next: ConsumerReadingPageV2) => {
    if (!compatible) return;
    if (model.report) {
      if (
        model.phase === "completed" &&
        (next === "result" || next === "report")
      ) {
        cancel();
        setPage(next);
      }
    } else if (enabled) {
      cancel();
      setPage(next);
    }
  };
  const feedback = (commit: () => void) => {
    // Same-tick double clicks cannot enqueue a second delayed navigation.
    if (!enabled || queued.current) return false;
    queued.current = true;
    timer.current = setTimeout(
      () => {
        timer.current = null;
        commit();
      },
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 400,
    );
    return true;
  };
  const event: typeof onEvent = (value) => {
    if (!compatible) return;
    if (
      [
        "choose-answer",
        "choose-preference",
        "navigate",
        "save",
        "complete",
      ].includes(value.type) &&
      !enabled
    )
      return;
    cancel();
    onEvent(value);
  };
  const props = {
    model,
    onEvent: event,
    onRead: read,
    ...(images ? { images } : {}),
  };
  const questions = model.entry?.questions ?? [];
  const count = questions.filter((q) =>
    model.draft?.answers.some(
      (a) =>
        a.questionId === q.ref.id &&
        q.options.some((o) => o.ref.id === a.optionId),
    ),
  ).length;
  const saved = consumerDraftStatusV2(model),
    allSaved =
      saved.preferenceSaved && saved.answersSaved && saved.progressSaved;
  if (model.phase === "denied")
    return (
      <div className={styles.host}>
        <Screen name="denied">
          <div className={styles.empty}>
            <h1>本次访问已结束</h1>
            <p>请重新验证后继续。</p>
            <a href="/access">返回访问入口</a>
          </div>
        </Screen>
      </div>
    );
  return (
    <div
      className={styles.host}
      data-qianzai-experience
      data-view-phase={model.phase}
      data-motion={motion ? "running" : "paused"}
      onTouchStart={(e) => {
        const t = e.touches[0];
        touch.current =
          e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
      }}
      onTouchEnd={(e) => {
        const t = e.changedTouches[0],
          start = touch.current;
        touch.current = null;
        if (
          !t ||
          !start ||
          start.y - t.clientY < 56 ||
          start.y - t.clientY < Math.abs(start.x - t.clientX) * 1.25
        )
          return;
        if (active === "cover") read("preference");
        else if (active === "result") read("report");
      }}
    >
      {model.entry?.kind === "synthetic" && (
        <p className={styles.synthetic}>
          合成内容与视觉容器验证 · 非正式题目或作者美术验收
        </p>
      )}
      {!!messages[model.phase] && (
        <aside className={styles.status} aria-label="本轮旅程状态">
          <p role="status">{messages[model.phase]}</p>
          {model.message && <p role="alert">{model.message}</p>}
          {model.pendingOperation &&
            ["unknown", "conflict", "unavailable"].includes(model.phase) && (
              <button onClick={() => onEvent({ type: "resolve" })}>
                核对{model.pendingOperation === "save" ? "保存" : "相逢"}结果
              </button>
            )}
          {model.phase === "conflict" && (
            <button onClick={() => onEvent({ type: "reload" })}>
              采用已核对的服务器进度
            </button>
          )}
          {!model.pendingOperation && model.phase === "unavailable" && (
            <button onClick={() => onEvent({ type: "reload" })}>
              重新读取
            </button>
          )}
        </aside>
      )}
      {!compatible ? (
        <Screen name="waiting">
          <div className={styles.empty}>
            <h1>
              {model.phase === "loading"
                ? "旅程正在展开"
                : "此版本暂未接入人物画卷"}
            </h1>
            <p>请等待当前固定版本读取完成。</p>
          </div>
        </Screen>
      ) : (
        <>
          {model.entry && model.draft && !model.report && (
            <div>
              <div hidden={active !== "cover"}>
                <QianzaiCover {...props} active={active === "cover"} />
              </div>
              <div hidden={active !== "preference"}>
                <QianzaiPreference
                  {...props}
                  onChoose={(value) => {
                    if (
                      feedback(() => {
                        const q =
                          model.draft?.progress.questionId ??
                          questions[0]?.ref.id;
                        if (q) {
                          onEvent({ type: "navigate", questionId: q });
                          setPage("question");
                        }
                      })
                    )
                      onEvent({ type: "choose-preference", preference: value });
                  }}
                />
              </div>
              <div hidden={active !== "question"}>
                <QianzaiQuestion
                  {...props}
                  {...((page === null || page === "report") && resumeQuestion
                    ? { readingQuestionId: resumeQuestion }
                    : {})}
                  onChoose={(questionId, optionId) => {
                    const index = questions.findIndex(
                        (q) => q.ref.id === questionId,
                      ),
                      target = questions[index + 1]?.ref.id ?? questionId;
                    if (
                      feedback(() =>
                        onEvent({ type: "navigate", questionId: target }),
                      )
                    )
                      onEvent({ type: "choose-answer", questionId, optionId });
                  }}
                />
              </div>
              <div hidden={active !== "resume"}>
                <Screen name="resume" className={styles.resume}>
                  <header>
                    <p className={styles.eyebrow}>三幕旅程</p>
                    <h1>回望来时的选择</h1>
                    <p>
                      已选 {count} / {questions.length} 题
                    </p>
                  </header>
                  <ol>
                    {questions.map((q, i) => (
                      <li key={q.ref.id}>
                        <button
                          disabled={!enabled}
                          onClick={() => {
                            event({ type: "navigate", questionId: q.ref.id });
                            read("question");
                          }}
                        >
                          <span>
                            第 {i + 1} 题 · {q.prompt}
                          </span>
                          <span>
                            {model.draft?.answers.some(
                              (a) => a.questionId === q.ref.id,
                            )
                              ? "已选择"
                              : "尚未选择"}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                  <button
                    className={styles.primary}
                    disabled={!enabled}
                    onClick={() => read("question")}
                  >
                    继续旅程
                  </button>
                  <button
                    disabled={
                      model.phase === "saving" || model.phase === "completing"
                    }
                    onClick={() => event({ type: "logout" })}
                  >
                    结束本次访问
                  </button>
                </Screen>
              </div>
              <div hidden={active !== "review"}>
                <Screen name="review" className={styles.review}>
                  <p className={styles.eyebrow}>三幕已毕 · 相逢将至</p>
                  <h1>
                    让此刻的选择
                    <br />
                    成为这场相逢
                  </h1>
                  <p>
                    已选 {count} / {questions.length}{" "}
                    题。确认后，本轮选择和人物长卷将成为同一份只读记录。
                  </p>
                  <button
                    className={styles.primary}
                    disabled={
                      !enabled ||
                      count !== questions.length ||
                      !questions.length ||
                      !allSaved
                    }
                    onClick={() => event({ type: "complete" })}
                  >
                    开启相逢
                  </button>
                  <button disabled={!enabled} onClick={() => read("resume")}>
                    再看一眼来时的路
                  </button>
                </Screen>
              </div>
            </div>
          )}
          {model.report && (
            <div inert={model.phase !== "completed"}>
              <div
                hidden={active !== "result"}
                onWheel={(e) => {
                  if (e.deltaY > 38) read("report");
                }}
                onKeyDown={(e) => {
                  if (["ArrowDown", "PageDown"].includes(e.key)) {
                    e.preventDefault();
                    read("report");
                  }
                }}
              >
                <QianzaiReveal {...props} />
              </div>
              <div hidden={active !== "report"}>
                <QianzaiReport {...props} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
