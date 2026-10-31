"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useMemo,
  type ReactNode,
  type RefObject,
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
  useQianzaiSceneScale,
} from "./views";
import { QianzaiReport } from "./report";
import type { QianzaiVisualProps } from "./art";
import { useQianzaiMotion } from "./motion";
import styles from "./qianzai.module.css";
import scenes from "./scenes.module.css";

export type QianzaiEmbeddedReport = {
  scrollContainer: RefObject<HTMLDivElement | null>;
  onReturn: () => void;
};
export type QianzaiReaderNavigation = {
  toReport: () => void;
  toReveal: () => void;
};
/** One native reading port. Geometry is local presentation, never business state. */
export function QianzaiContinuousReader({
  navigation,
  initialReport = false,
  reveal,
  report,
}: {
  navigation: RefObject<QianzaiReaderNavigation | null>;
  initialReport?: boolean;
  reveal: (active: boolean) => ReactNode;
  report: (embedded: QianzaiEmbeddedReport) => ReactNode;
}) {
  const scrollContainer = useRef<HTMLDivElement>(null);
  const [revealActive, setRevealActive] = useState(!initialReport);
  const initialPositioned = useRef(false);
  const previousHeight = useRef<number | null>(null);
  const focusDestination = useRef<{ top: number; selector: string } | null>(
    null,
  );
  const locate = useCallback(
    (report: boolean, focus = true, instant = false) => {
      const node = scrollContainer.current;
      if (!node) return;
      const anchor = node.querySelector<HTMLElement>(
        report ? "[data-qianzai-report-start]" : "[data-reveal-continue]",
      );
      const toolbar = node.querySelector<HTMLElement>(
        "[data-qianzai-report-toolbar]",
      );
      const top =
        report && anchor
          ? node.scrollTop +
            anchor.getBoundingClientRect().top -
            node.getBoundingClientRect().top -
            (toolbar?.offsetHeight ?? 128)
          : 0;
      const target = Math.min(
        Math.max(0, top),
        Math.max(0, node.scrollHeight - node.clientHeight),
      );
      focusDestination.current = focus
        ? {
            top: target,
            selector: report
              ? "[data-report-opening-title]"
              : "[data-reveal-continue]",
          }
        : null;
      node.scrollTo({
        top: target,
        behavior:
          instant ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
      });
      // Instant/zero-distance navigation may not emit a scroll event. Release
      // the reveal's inert boundary before transferring focus back into it.
      if (focus && Math.abs(node.scrollTop - target) < 1) {
        const visual = node.querySelector<HTMLElement>(
          "[data-qianzai-reveal-sticky]",
        );
        if (visual) visual.inert = report;
        setRevealActive(!report);
        const destination = focusDestination.current;
        focusDestination.current = null;
        if (destination)
          node
            .querySelector<HTMLElement>(destination.selector)
            ?.focus({ preventScroll: true });
      }
    },
    [],
  );
  const embedded = useMemo(
    () => ({ scrollContainer, onReturn: () => locate(false) }),
    [locate],
  );
  useImperativeHandle(
    navigation,
    () => ({ toReport: () => locate(true), toReveal: () => locate(false) }),
    [locate],
  );
  useLayoutEffect(() => {
    const node = scrollContainer.current;
    if (!node) return;
    const measure = () => {
      const height = node.clientHeight;
      const oldHeight = previousHeight.current;
      const oldTop = node.scrollTop;
      node.style.setProperty("--qianzai-reveal-height", `${height}px`);
      const start = node.querySelector<HTMLElement>(
        "[data-qianzai-report-start]",
      );
      const toolbar = node.querySelector<HTMLElement>(
        "[data-qianzai-report-toolbar]",
      );
      // Browser chrome/orientation changes alter the reveal spacer. Keep the
      // currently read paragraph at the same line instead of resetting to top.
      if (
        oldHeight !== null &&
        oldHeight !== height &&
        oldTop >= oldHeight - (toolbar?.offsetHeight ?? 128)
      )
        node.scrollTop = oldTop + height - oldHeight;
      previousHeight.current = height;
      const distance = start
        ? node.scrollTop +
          start.getBoundingClientRect().top -
          node.getBoundingClientRect().top -
          (toolbar?.offsetHeight ?? 128)
        : node.clientHeight;
      const progress = Math.max(
        0,
        Math.min(1, node.scrollTop / Math.max(1, distance)),
      );
      node.style.setProperty("--qianzai-reader-progress", String(progress));
      // The old baked header is covered before any new toolbar text appears.
      // Enable its controls only once that text has reached full opacity.
      if (toolbar) toolbar.inert = progress < 0.28;
      const visual = node.querySelector<HTMLElement>(
        "[data-qianzai-reveal-sticky]",
      );
      if (visual) visual.inert = progress >= 0.1;
      node.dataset.toolbarVisible = String(progress >= 0.28);
      setRevealActive(progress < 0.1);
      const destination = focusDestination.current;
      if (destination && Math.abs(node.scrollTop - destination.top) < 1) {
        focusDestination.current = null;
        node
          .querySelector<HTMLElement>(destination.selector)
          ?.focus({ preventScroll: true });
      }
      // A may mount its marker after the first layout. Locate only once; resizing
      // never resets the reader or replays reveal/score/complete operations.
      if (initialReport && start && !initialPositioned.current) {
        initialPositioned.current = true;
        locate(true, false, true);
      }
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    if (node.lastElementChild) resize.observe(node.lastElementChild);
    node.addEventListener("scroll", measure, { passive: true });
    return () => {
      resize.disconnect();
      node.removeEventListener("scroll", measure);
    };
  }, [initialReport, locate]);
  return (
    <div
      ref={scrollContainer}
      className={styles.continuousReader}
      data-qianzai-continuous-reader
      tabIndex={0}
      aria-label="人物揭晓与六卷报告"
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !(event.target as Element).closest("nav,[role=dialog],details")
        )
          locate(false);
      }}
    >
      <div className={styles.readerBackdropTrack}>
        <div
          className={styles.readerBackdropSticky}
          data-qianzai-reveal-sticky
          inert={!revealActive}
        >
          {reveal(revealActive)}
        </div>
      </div>
      <div className={styles.readerReportFlow} data-reader-paper>
        <div className={styles.readerToolbarCover} aria-hidden="true" />
        {report(embedded)}
      </div>
    </div>
  );
}

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
  roleCompositeImages,
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
  const sceneScale = useQianzaiSceneScale();
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
  const finalAnswer = useRef<{
    questionId: string;
    optionId: string;
    entry: typeof model.entry;
    stage: "feedback" | "save" | "complete";
  } | null>(null);
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
  const settleFrame = useRef<number | null>(null);
  const readerNavigation = useRef<QianzaiReaderNavigation | null>(null);
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
    if (revealTimer.current !== null) clearTimeout(revealTimer.current);
    revealTimer.current = null;
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
          duration - midpoint + 30,
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
      if (!compatible || model.phase === "denied") finalAnswer.current = null;
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
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const interrupt = () => {
      if (document.hidden || media.matches) {
        finalAnswer.current = null;
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
      if (settleFrame.current !== null)
        cancelAnimationFrame(settleFrame.current);
      if (revealTimer.current !== null) clearTimeout(revealTimer.current);
    };
  }, [cancel, settleReading]);
  const transition = (
    kind: "cover" | "preference" | "chapter" | "reveal",
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
    const staticChapter = !motion && kind === "chapter";
    if (!node || (!motion && !staticChapter)) {
      commit();
      return;
    }
    const duration =
      kind === "reveal"
        ? 1030
        : kind === "chapter"
          ? staticChapter
            ? 450
            : 860
          : 660;
    const midpoint = Math.round(duration * 0.51),
      token = generation.current;
    void node.offsetWidth;
    node.hidden = false;
    node.dataset.active = "true";
    node.dataset.kind = kind;
    node.dataset.reduced = String(staticChapter);
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
          (!staticChapter &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches)
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
    readerNavigation.current?.toReveal();
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
    finalAnswer.current = null;
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
    if (chapter) {
      transition(
        "chapter",
        questions[to]!.act,
        () => latest.current.onEvent({ type: "navigate", questionId }),
        questionId,
      );
    } else {
      // Ordinary question changes have no visual transition. The controller's
      // save/accepted phase alone gates input; no hidden presentation tail.
      cancel();
      latest.current.onEvent({ type: "navigate", questionId });
    }
  };
  const read = (next: ConsumerReadingPageV2) => {
    if (!compatible) return;
    finalAnswer.current = null;
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
        cancel();
        settleReading();
        if (next === "report") readerNavigation.current?.toReport();
        else readerNavigation.current?.toReveal();
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
    ...(roleCompositeImages ? { roleCompositeImages } : {}),
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
  useEffect(() => {
    const intent = finalAnswer.current;
    if (
      !intent ||
      intent.stage !== "save" ||
      !enabled ||
      !allSaved ||
      model.pendingOperation !== null ||
      model.entry !== intent.entry ||
      model.state?.progress.questionId !== intent.questionId ||
      model.draft?.progress.questionId !== intent.questionId ||
      model.draft.answers.find((a) => a.questionId === intent.questionId)
        ?.optionId !== intent.optionId
    )
      return;
    const accepted = model.state,
      token = generation.current;
    const frame = requestAnimationFrame(() => {
      const current = latest.current.model,
        status = consumerDraftStatusV2(current);
      if (
        finalAnswer.current !== intent ||
        generation.current !== token ||
        document.hidden ||
        !canEditConsumerV2(current) ||
        current.pendingOperation !== null ||
        current.state !== accepted ||
        current.entry !== intent.entry ||
        !status.preferenceSaved ||
        !status.answersSaved ||
        !status.progressSaved ||
        current.draft?.answers.find((a) => a.questionId === intent.questionId)
          ?.optionId !== intent.optionId
      )
        return;
      intent.stage = "complete";
      queued.current = true;
      latest.current.onEvent({ type: "complete" });
    });
    return () => cancelAnimationFrame(frame);
  }, [model, enabled, allSaved]);
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
          active === "cover" && !excluded && e.touches.length === 1 && t
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
      }}
    >
      {model.entry?.kind === "synthetic" && (
        <p className={styles.synthetic}>
          合成内容与视觉容器验证 · 非正式题目或作者美术验收
        </p>
      )}
      {!!messages[model.phase] && (
        <aside
          className={
            model.phase === "saving" && !model.message
              ? styles.srOnly
              : styles.status
          }
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
        <div className={`${styles.sceneFrame} ${scenes.journey}`}>
          <div
            ref={stage}
            data-qianzai-transition
            style={{
              left: `calc(50% - ${195 * sceneScale}px)`,
              transform: `scale(${sceneScale})`,
            }}
            className={scenes.transitionStage}
            aria-hidden="true"
          >
            <div className={scenes.transitionCurtain} />
            <div className={scenes.transitionRibbon} />
            <div className={scenes.transitionFiligree} />
            <div className={scenes.transitionWords}>
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
                      feedback(enterPreferredAct);
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
                      if (index === questions.length - 1) {
                        if (finalAnswer.current?.stage === "feedback") cancel();
                        finalAnswer.current = null;
                        if (
                          feedback(() => {
                            const intent = finalAnswer.current,
                              current = latest.current.model;
                            if (
                              !intent ||
                              intent.questionId !== questionId ||
                              intent.optionId !== optionId ||
                              current.draft?.answers.find(
                                (a) => a.questionId === questionId,
                              )?.optionId !== optionId
                            )
                              return;
                            intent.stage = "save";
                            latest.current.onEvent({ type: "save" });
                          })
                        ) {
                          finalAnswer.current = {
                            questionId,
                            optionId,
                            entry: model.entry,
                            stage: "feedback",
                          };
                          onEvent({
                            type: "choose-answer",
                            questionId,
                            optionId,
                          });
                        }
                        return;
                      }
                      finalAnswer.current = null;
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
                <QianzaiContinuousReader
                  key={reportKey}
                  navigation={readerNavigation}
                  initialReport={initialScreen === "report"}
                  reveal={(visible) => (
                    <QianzaiReveal
                      key={`${reportKey}:${reveal.cycle}`}
                      {...props}
                      active={visible}
                      presentation={reveal.phase}
                      startedAt={reveal.startedAt}
                      onReplay={() => playReveal(false)}
                    />
                  )}
                  report={(embedded) => (
                    <QianzaiReport {...props} {...{ embedded }} active />
                  )}
                />
              )}
          </div>
        </div>
      )}
    </div>
  );
}
