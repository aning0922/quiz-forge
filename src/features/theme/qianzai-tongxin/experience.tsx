"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  ConsumerExperiencePropsV2,
  ConsumerReadingPageV2,
} from "../consumer-v2/interfaces";
import {
  canEditConsumerV2,
  consumerDraftStatusV2,
} from "../consumer-v2/components";
import {
  ACTS,
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

type RevealPresentation = "waiting" | "playing" | "ready";
const viewedReports = new Set<string>();
function rememberReport(key: string) {
  viewedReports.add(key);
  if (viewedReports.size > 64)
    viewedReports.delete(viewedReports.values().next().value!);
}
function reportIdentity(model: QianzaiTongxinExperienceProps["model"]) {
  const receipt = model.report?.receipt;
  return receipt
    ? `${receipt.binding.session.sessionId}:${receipt.reportId}:${receipt.reportSnapshotSha256}`
    : null;
}

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
/** Dedicated D3 renderer. The compiled registry/authorized resource owner is
 * integrated separately by the coordinator. IO, CAS and original pending identity
 * remain exclusively in ConsumerControllerV2; timers below only present a click.
 */
export function QianzaiTongxinExperience({
  model,
  onEvent,
  initialScreen,
  images,
  prototypeImages,
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
  const stage = useRef<HTMLDivElement>(null);
  const sceneContent = useRef<HTMLDivElement>(null);
  const stageTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const generation = useRef(0);
  const latest = useRef({ model, compatible, onEvent });
  useLayoutEffect(() => {
    latest.current = { model, compatible, onEvent };
  }, [model, compatible, onEvent]);
  const reportKey = reportIdentity(model);
  const [reveal, setReveal] = useState<{
    phase: RevealPresentation;
    startedAt: number;
    cycle: number;
  }>({ phase: "waiting", startedAt: 0, cycle: 0 });
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readerFrame = useRef<number | null>(null);
  const settleFrame = useRef<number | null>(null);
  const readerDeck = useRef<HTMLDivElement>(null);
  const [readerVisit, setReaderVisit] = useState(0);
  const [readerMoving, setReaderMoving] = useState<
    "prepare" | "enter" | "leave" | null
  >(null);
  const readerTarget = useRef<"result" | "report" | null>(
    initialScreen === "report" ? "report" : null,
  );
  const seenReport = useRef<string | null>(null);
  const waiting = useRef<{
    token: number;
    kind: string;
    target: string;
    duration: number;
    midpoint: number;
  } | null>(null);
  const hideStage = useCallback(() => {
    stageTimers.current.forEach(clearTimeout);
    stageTimers.current = [];
    waiting.current = null;
    if (stage.current) {
      stage.current.hidden = true;
      stage.current.removeAttribute("data-active");
    }
    if (sceneContent.current) sceneContent.current.inert = false;
    queued.current = false;
  }, []);
  const cancel = useCallback(() => {
    generation.current++;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    hideStage();
  }, [hideStage]);
  const settleReading = useCallback(() => {
    if (readerTimer.current !== null) clearTimeout(readerTimer.current);
    if (readerFrame.current !== null) cancelAnimationFrame(readerFrame.current);
    readerFrame.current = null;
    if (revealTimer.current !== null) clearTimeout(revealTimer.current);
    readerTimer.current = null;
    revealTimer.current = null;
    setReaderMoving(null);
    setReveal((old) =>
      old.phase === "ready" ? old : { ...old, phase: "ready" },
    );
  }, []);
  const settleOnFrame = useCallback(() => {
    if (settleFrame.current !== null) cancelAnimationFrame(settleFrame.current);
    // Invalid model phases already hide the reader synchronously in render.
    // Clear its presentation state at the next browser frame, without a render cascade.
    settleFrame.current = requestAnimationFrame(settleReading);
  }, [settleReading]);
  const finishStage = useCallback(
    (duration: number, midpoint: number, token: number) => {
      if (generation.current !== token || !stage.current) return;
      waiting.current = null;
      stage.current.dataset.step = "enter";
      for (const animation of stage.current.getAnimations({ subtree: true }))
        animation.play();
      stageTimers.current.push(
        setTimeout(
          () => {
            if (generation.current === token) hideStage();
          },
          duration -
            midpoint +
            (stage.current.dataset.kind === "paper" ? 0 : 30),
        ),
      );
    },
    [hideStage],
  );
  useEffect(() => {
    if (
      !compatible ||
      ["unknown", "conflict", "unavailable", "denied"].includes(model.phase)
    ) {
      cancel();
      settleOnFrame();
      return;
    }
    if (model.phase !== "ready") {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      queued.current = false;
      const sent = waiting.current !== null;
      if (
        !(sent && model.phase === "saving") &&
        !(
          model.phase === "completed" &&
          stage.current?.dataset.kind === "reveal"
        )
      )
        hideStage();
    } else if (
      waiting.current &&
      model.pendingOperation === null &&
      model.draft?.progress.questionId === waiting.current.target
    ) {
      const pending = waiting.current;
      finishStage(pending.duration, pending.midpoint, pending.token);
    }
  }, [
    model.phase,
    model.pendingOperation,
    model.draft?.progress.questionId,
    compatible,
    cancel,
    hideStage,
    finishStage,
    settleOnFrame,
  ]);
  const acceptedQuestion = useRef(model.state?.progress.questionId ?? null);
  useEffect(() => {
    if (model.phase !== "ready" || !compatible) return;
    const next = model.state?.progress.questionId ?? null,
      previous = acceptedQuestion.current;
    acceptedQuestion.current = next;
    if (
      !previous ||
      !next ||
      previous === next ||
      waiting.current ||
      stage.current?.dataset.active === "true" ||
      document.hidden ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    // A reconciled receipt may arrive after a conflict cancelled its veil. This
    // is an entrance for an already-accepted question, never another dispatch.
    const node = stage.current;
    if (!node) return;
    cancel();
    const token = generation.current;
    node.hidden = false;
    node.dataset.active = "true";
    node.dataset.kind = "paper";
    node.dataset.step = "enter";
    stageTimers.current = [
      setTimeout(() => {
        if (generation.current === token) hideStage();
      }, 310),
    ];
  }, [
    model.phase,
    model.state?.progress.questionId,
    compatible,
    cancel,
    hideStage,
  ]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const interrupt = () => {
      if (document.hidden || media.matches) {
        cancel();
        settleReading();
      }
    };
    document.addEventListener("visibilitychange", interrupt);
    media.addEventListener("change", interrupt);
    return () => {
      document.removeEventListener("visibilitychange", interrupt);
      media.removeEventListener("change", interrupt);
      cancel();
      if (readerTimer.current !== null) clearTimeout(readerTimer.current);
      if (readerFrame.current !== null)
        cancelAnimationFrame(readerFrame.current);
      if (settleFrame.current !== null)
        cancelAnimationFrame(settleFrame.current);
      if (revealTimer.current !== null) clearTimeout(revealTimer.current);
    };
  }, [cancel, settleReading]);
  const transition = (
    kind: "cover" | "preference" | "chapter" | "paper" | "reveal",
    act: number,
    commit: () => void,
    target?: string,
  ) => {
    cancel();
    const current = latest.current,
      identity = reportIdentity(current.model),
      state = current.model.state;
    const allowed = () =>
      latest.current.compatible &&
      !document.hidden &&
      (kind === "reveal"
        ? latest.current.model.phase === "completed" &&
          latest.current.model.pendingOperation === null &&
          reportIdentity(latest.current.model) === identity
        : canEditConsumerV2(latest.current.model) &&
          latest.current.model.state === state);
    if (!allowed()) return;
    const node = stage.current;
    if (!motion || !node) {
      commit();
      return;
    }
    const duration =
      kind === "reveal"
        ? 1030
        : kind === "chapter"
          ? 860
          : kind === "paper"
            ? 465
            : 660;
    const midpoint = kind === "paper" ? 155 : Math.round(duration * 0.51),
      token = generation.current;
    void node.offsetWidth;
    node.hidden = false;
    node.dataset.active = "true";
    node.dataset.kind = kind;
    node.dataset.act = String(act);
    node.dataset.step = "leave";
    node.style.setProperty("--transition-duration", duration + "ms");
    const caption = ACTS[act - 1];
    for (const [part, text] of Object.entries(
      kind === "reveal"
        ? {
            kicker: "终章",
            title: "命定相逢",
            place: "千载之间 · 同心之人",
            line: "月色为引 · 故人将至",
          }
        : {
            kicker: ["第一幕", "第二幕", "第三幕"][act - 1] ?? "",
            title: caption?.title ?? "",
            place: caption?.place ?? "",
            line: act > 1 ? (ACTS[act - 2]?.line ?? "") : "",
          },
    )) {
      const leaf = node.querySelector<HTMLElement>(
        `[data-transition-part="${part}"]`,
      );
      if (leaf) leaf.textContent = text;
    }
    if (sceneContent.current) sceneContent.current.inert = true;
    queued.current = true;
    stageTimers.current = [
      setTimeout(() => {
        if (
          generation.current !== token ||
          !allowed() ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
          cancel();
          return;
        }
        if (target) {
          node.dataset.step = "wait";
          waiting.current = { token, kind, target, duration, midpoint };
          for (const animation of node.getAnimations({ subtree: true })) {
            animation.pause();
            animation.currentTime = midpoint;
          }
          commit();
        } else {
          commit();
          finishStage(duration, midpoint, token);
        }
      }, midpoint),
    ];
  };
  const playReveal = (veil: boolean) => {
    if (
      latest.current.model.phase !== "completed" ||
      latest.current.model.pendingOperation !== null ||
      !reportIdentity(latest.current.model)
    )
      return;
    cancel();
    settleReading();
    readerTarget.current = "result";
    setPage("result");
    const begin = () => {
      if (
        document.hidden ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        setReveal((old) => ({ ...old, phase: "ready" }));
        return;
      }
      const identity = reportIdentity(latest.current.model),
        token = generation.current;
      setReveal((old) => ({
        phase: "playing",
        startedAt: performance.now(),
        cycle: old.cycle + 1,
      }));
      revealTimer.current = setTimeout(() => {
        if (
          generation.current === token &&
          latest.current.model.phase === "completed" &&
          reportIdentity(latest.current.model) === identity
        )
          setReveal((old) => ({ ...old, phase: "ready" }));
      }, 2000);
    };
    if (!motion) {
      setReveal((old) => ({ ...old, phase: "ready" }));
      return;
    }
    setReveal((old) => ({ ...old, phase: "waiting" }));
    if (veil) transition("reveal", 3, begin);
    else begin();
  };
  useEffect(() => {
    if (
      !reportKey ||
      model.phase !== "completed" ||
      model.pendingOperation !== null ||
      seenReport.current === reportKey
    )
      return;
    seenReport.current = reportKey;
    const shouldPlay =
      initialScreen !== "report" && !viewedReports.has(reportKey);
    rememberReport(reportKey);
    const token = generation.current;
    const frame = requestAnimationFrame(() => {
      if (
        generation.current !== token ||
        latest.current.model.phase !== "completed" ||
        latest.current.model.pendingOperation !== null ||
        reportIdentity(latest.current.model) !== reportKey
      )
        return;
      if (
        !shouldPlay ||
        document.hidden ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        cancel();
        settleReading();
      } else playReveal(true);
    });
    return () => cancelAnimationFrame(frame);
    // A lease can remount this component on entry -> report. Identity, rather
    // than a phase edge in the old mount, owns this one presentation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportKey, model.phase, model.pendingOperation]);
  const enterPreferredAct = () => {
    const current = latest.current.model;
    const q =
      current.draft?.progress.questionId ?? current.entry?.questions[0]?.ref.id;
    if (!q || !current.draft?.matchingContext) return;
    const act =
      current.entry?.questions.find((question) => question.ref.id === q)?.act ??
      1;
    const saved = consumerDraftStatusV2(current);
    const needsSave = !(
      saved.preferenceSaved &&
      saved.answersSaved &&
      saved.progressSaved &&
      current.state?.progress.questionId === q
    );
    transition(
      "chapter",
      act,
      () => {
        latest.current.onEvent({ type: "navigate", questionId: q });
        setPage("question");
      },
      needsSave ? q : undefined,
    );
  };
  const navigateQuestion = (questionId: string) => {
    const questions = model.entry?.questions ?? [];
    const from = questions.findIndex(
        (q) => q.ref.id === model.draft?.progress.questionId,
      ),
      to = questions.findIndex((q) => q.ref.id === questionId);
    if (to < 0) return;
    if (to === from) {
      cancel();
      onEvent({ type: "navigate", questionId });
      return;
    }
    const chapter = to > from && questions[to]?.act !== questions[from]?.act;
    transition(
      chapter ? "chapter" : "paper",
      questions[to]!.act,
      () => latest.current.onEvent({ type: "navigate", questionId }),
      questionId,
    );
  };
  const read = (next: ConsumerReadingPageV2) => {
    if (!compatible) return;
    if (
      active === "preference" &&
      next === "question" &&
      timer.current !== null &&
      queued.current
    )
      return;
    if (model.report) {
      if (
        model.phase === "completed" &&
        (next === "result" || next === "report")
      ) {
        if (
          readerTarget.current === next ||
          (readerTarget.current === null && active === next)
        )
          return;
        cancel();
        settleReading();
        readerTarget.current = next;
        setPage(next);
        if (next === "report") setReaderVisit((old) => old + 1);
        if (motion) {
          setReaderMoving(next === "report" ? "prepare" : "leave");
          const identity = reportIdentity(model),
            token = generation.current;
          if (next === "report")
            readerFrame.current = requestAnimationFrame(() => {
              if (
                generation.current !== token ||
                document.hidden ||
                reportIdentity(latest.current.model) !== identity
              )
                return;
              readerDeck.current
                ?.querySelector("[data-reader-paper]")
                ?.getBoundingClientRect();
              setReaderMoving("enter");
            });
          readerTimer.current = setTimeout(() => {
            if (
              generation.current === token &&
              latest.current.model.phase === "completed" &&
              reportIdentity(latest.current.model) === identity
            ) {
              setReaderMoving(null);
              readerDeck.current
                ?.querySelector<HTMLElement>(
                  next === "report"
                    ? "[data-report-opening-title]"
                    : "[data-reveal-continue]",
                )
                ?.focus({ preventScroll: true });
            }
          }, 720);
        }
      }
    } else if (enabled) {
      if (active === "cover" && next === "preference") {
        if (stageTimers.current.length) return;
        transition("cover", 1, () => setPage(next));
      } else if (active === "preference" && next === "question") {
        enterPreferredAct();
      } else {
        cancel();
        setPage(next);
      }
    }
  };
  const feedback = (commit: () => void) => {
    // Same-tick double clicks cannot enqueue a second delayed navigation.
    if (!enabled || queued.current || stageTimers.current.length) return false;
    queued.current = true;
    const token = generation.current,
      state = latest.current.model.state;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (
        generation.current !== token ||
        document.hidden ||
        !latest.current.compatible ||
        !canEditConsumerV2(latest.current.model) ||
        latest.current.model.state !== state
      ) {
        cancel();
        return;
      }
      commit();
    }, 400);
    return true;
  };
  const event: typeof onEvent = (value) => {
    if (!compatible || (value.type === "complete" && queued.current)) return;
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
    if (timer.current !== null && queued.current) {
      if (
        ["save", "complete"].includes(value.type) ||
        (value.type === "navigate" && active === "preference")
      )
        return;
      if (
        value.type === "navigate" &&
        value.questionId &&
        active === "question"
      ) {
        const questions = model.entry?.questions ?? [];
        const from = questions.findIndex(
            (q) => q.ref.id === model.draft?.progress.questionId,
          ),
          to = questions.findIndex((q) => q.ref.id === value.questionId);
        if (to >= from) return;
      }
    }
    if (value.type === "navigate" && value.questionId && active === "question")
      navigateQuestion(value.questionId);
    else {
      cancel();
      if (value.type === "complete") queued.current = true;
      latest.current.onEvent(value);
    }
  };
  const props = {
    model,
    onEvent: event,
    onRead: read,
    ...(images ? { images } : {}),
    ...(prototypeImages ? { prototypeImages } : {}),
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
        const excluded = (e.target as Element).closest(
          "[data-qianzai-scroll-region],button,a,input,label,summary,details,nav",
        );
        touch.current =
          (active === "cover" || active === "result") &&
          !excluded &&
          e.touches.length === 1 &&
          t
            ? { x: t.clientX, y: t.clientY }
            : null;
      }}
      onTouchCancel={() => {
        touch.current = null;
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
        <aside
          className={styles.status}
          aria-label="本轮旅程状态"
          aria-busy={model.phase === "saving" || model.phase === "completing"}
        >
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
        <div className={styles.sceneFrame}>
          <div
            ref={stage}
            data-qianzai-transition
            className={styles.transitionStage}
            aria-hidden="true"
          >
            <div className={styles.transitionCurtain} />
            <div className={styles.transitionRibbon} />
            <div className={styles.transitionFiligree} />
            <div className={styles.transitionWords}>
              <p data-transition-part="kicker" />
              <h2 data-transition-part="title" />
              <p data-transition-part="place" />
              <p data-transition-part="line" />
            </div>
          </div>
          <div ref={sceneContent}>
            {model.entry && model.draft && !model.report && (
              <div>
                <div hidden={active !== "cover"}>
                  <QianzaiCover {...props} active={active === "cover"} />
                </div>
                <div hidden={active !== "preference"}>
                  <QianzaiPreference
                    {...props}
                    onEnter={() => {
                      if (queued.current || stageTimers.current.length) return;
                      enterPreferredAct();
                    }}
                    onChoose={(value) => {
                      if (feedback(enterPreferredAct))
                        onEvent({
                          type: "choose-preference",
                          preference: value,
                        });
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
                      if (feedback(() => navigateQuestion(target)))
                        onEvent({
                          type: "choose-answer",
                          questionId,
                          optionId,
                        });
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
            {model.report &&
              model.phase === "completed" &&
              model.pendingOperation === null && (
                <div
                  ref={readerDeck}
                  className={styles.readerDeck}
                  data-reader-page={active}
                  data-reader-moving={readerMoving ?? undefined}
                  inert={model.phase !== "completed"}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && active === "report") {
                      e.preventDefault();
                      read("result");
                    }
                  }}
                >
                  <div
                    className={styles.readerResult}
                    hidden={
                      active !== "result" &&
                      readerMoving !== "enter" &&
                      readerMoving !== "prepare"
                    }
                    onWheel={(e) => {
                      if (
                        (e.target as Element).closest(
                          "[data-qianzai-scroll-region],button,a,summary,details,nav",
                        )
                      )
                        return;
                      if (e.deltaY > 38) read("report");
                    }}
                    onKeyDown={(e) => {
                      if (
                        (e.target as Element).closest(
                          "[data-qianzai-scroll-region],button,a,input,summary,details,nav",
                        )
                      )
                        return;
                      if (["ArrowDown", "PageDown"].includes(e.key)) {
                        e.preventDefault();
                        read("report");
                      }
                    }}
                  >
                    <QianzaiReveal
                      key={`${reportKey}:${reveal.cycle}`}
                      {...props}
                      active={active === "result"}
                      presentation={reveal.phase}
                      startedAt={reveal.startedAt}
                      onReplay={() => playReveal(false)}
                    />
                  </div>
                  <div
                    data-reader-paper
                    className={styles.readerReport}
                    hidden={active !== "report" && readerMoving !== "leave"}
                  >
                    <QianzaiReport
                      {...props}
                      entry={readerVisit}
                      active={active === "report"}
                    />
                  </div>
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
