"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import { ScrollRule } from "../ornaments";
import {
  historicalDemoAnsweredCount,
  historicalDemoQuestions,
  historicalDemoStorageKey,
  historicalDemoVersion,
  readHistoricalDemoProgress,
} from "@/features/quiz/historical-demo";
import { SelectedHistoricalShell } from "./shell";
import styles from "./selected.module.css";

type Notice = "save-failed" | "corrupt" | "conflict" | null;

export function HistoricalExperience() {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<
    "loading" | "resume" | "question" | "confirm" | "complete"
  >("loading");
  const [notice, setNotice] = useState<Notice>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [storageEnabled, setStorageEnabled] = useState(true);
  const [isSaved, setIsSaved] = useState(false);
  const [storageUnsafe, setStorageUnsafe] = useState(false);
  const [hasCorruptBookmark, setHasCorruptBookmark] = useState(false);
  const [conflictLocked, setConflictLocked] = useState(false);
  const isInitialQuestionPhase = useRef(true);
  const current = historicalDemoQuestions[index]!;
  const completed = historicalDemoAnsweredCount(answers);
  const isAnswered = Number.isInteger(answers[current.id]);
  const unanswered = useMemo(
    () =>
      historicalDemoQuestions.filter(
        (question) => !Number.isInteger(answers[question.id]),
      ),
    [answers],
  );

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved = readHistoricalDemoProgress(
          window.localStorage.getItem(historicalDemoStorageKey),
        );
        if (saved && historicalDemoAnsweredCount(saved.answers)) {
          setAnswers(saved.answers);
          setSavedAt(saved.updatedAt);
          setIndex(
            Math.max(
              0,
              historicalDemoQuestions.findIndex(
                (item) => !Number.isInteger(saved.answers[item.id]),
              ),
            ),
          );
          setPhase("resume");
        } else setPhase("question");
      } catch {
        setNotice("corrupt");
        setStorageUnsafe(true);
        setHasCorruptBookmark(true);
        setPhase("question");
      }
    });
    const handleStorage = (event: StorageEvent) => {
      if (event.key === historicalDemoStorageKey || event.key === null) {
        setConflictLocked(true);
        setNotice("conflict");
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (phase !== "question") return;
    if (isInitialQuestionPhase.current && index === 0) {
      isInitialQuestionPhase.current = false;
      return;
    }
    isInitialQuestionPhase.current = false;
    const heading = document.getElementById("question-heading");
    heading?.scrollIntoView({ block: "start", behavior: "auto" });
    heading?.focus();
  }, [index, phase]);

  function save(nextAnswers = answers) {
    if (conflictLocked) return false;
    if (!storageEnabled || storageUnsafe) {
      setNotice("save-failed");
      return false;
    }
    try {
      const updatedAt = new Date().toISOString();
      window.localStorage.setItem(
        historicalDemoStorageKey,
        JSON.stringify({
          version: historicalDemoVersion,
          answers: nextAnswers,
          updatedAt,
        }),
      );
      setSavedAt(updatedAt);
      setIsSaved(true);
      return true;
    } catch {
      setNotice("save-failed");
      return false;
    }
  }

  function choose(optionIndex: number) {
    const next = { ...answers };
    if (next[current.id] === optionIndex) delete next[current.id];
    else next[current.id] = optionIndex;
    setAnswers(next);
    setIsSaved(false);
    save(next);
  }

  function selectWithKeyboard(optionIndex: number) {
    const next = { ...answers, [current.id]: optionIndex };
    setAnswers(next);
    setIsSaved(false);
    save(next);
  }

  function continueFlow() {
    if (notice === "conflict") return;
    setPhase("question");
  }

  function goNext() {
    if (!isAnswered || conflictLocked) return;
    if (index === historicalDemoQuestions.length - 1) setPhase("confirm");
    else {
      setIndex((value) => value + 1);
    }
  }

  function clearDemo() {
    try {
      window.localStorage.removeItem(historicalDemoStorageKey);
    } catch {
      setNotice("save-failed");
      return;
    }
    setAnswers({});
    setSavedAt(null);
    setIsSaved(false);
    setIndex(0);
    setNotice(null);
    setStorageUnsafe(false);
    setHasCorruptBookmark(false);
    setConflictLocked(false);
    setPhase("question");
  }

  function demoCorrupt() {
    window.localStorage.setItem(historicalDemoStorageKey, "not-valid-json");
    setNotice("corrupt");
    setStorageUnsafe(true);
    setHasCorruptBookmark(true);
    setPhase("resume");
  }

  function demoConflict() {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: historicalDemoStorageKey,
        newValue: "external-change",
      }),
    );
    setNotice("conflict");
    setPhase("resume");
  }

  if (phase === "loading") {
    return (
      <SelectedHistoricalShell state="experience">
        <div className={styles.experienceLoading}>正在打开演示书卷…</div>
      </SelectedHistoricalShell>
    );
  }

  return (
    <SelectedHistoricalShell state="experience">
      <div className={styles.experience}>
        <div className={styles.demoDisclosure}>
          <ShieldAlert size={17} aria-hidden="true" />
          <p>
            <strong>合成题目：</strong>仅保存在此浏览器；非正式测评，
            不会生成匹配结果。
          </p>
        </div>
        {notice && (
          <section
            className={styles.demoAlert}
            role="status"
            aria-live="polite"
          >
            <p>
              {notice === "save-failed"
                ? "暂存没有写入浏览器。你仍可继续答题，但退出后不会恢复。"
                : notice === "corrupt"
                  ? "发现无法读取的演示书签。为避免丢失证据，本页没有自动清除它；请在异常演示中手动重置。"
                  : "检测到另一个演示副本可能已更新。为避免覆盖，请先决定使用哪一份。"}
            </p>
            {notice === "conflict" && (
              <div className={styles.alertActions}>
                <button
                  onClick={() => {
                    setNotice(null);
                    setConflictLocked(false);
                    setPhase("question");
                  }}
                >
                  使用此页草稿
                </button>
                <button onClick={clearDemo}>放弃并重新开始</button>
              </div>
            )}
            {hasCorruptBookmark && (
              <div className={styles.alertActions}>
                <button onClick={clearDemo}>丢弃损坏书签，重新开始</button>
              </div>
            )}
          </section>
        )}
        {phase === "resume" ? (
          <section
            className={styles.resumeSheet}
            aria-labelledby="resume-title"
          >
            <p className={styles.kicker}>书签暂存 / 本机演示</p>
            <h1 id="resume-title">上次的思考，仍停在这里</h1>
            <p>
              已记录 <strong>{completed}</strong> /{" "}
              {historicalDemoQuestions.length} 题
              {savedAt
                ? `，最后暂存于 ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(savedAt))}`
                : ""}
              。
            </p>
            <ScrollRule />
            <button
              className={styles.primaryButton}
              onClick={continueFlow}
              disabled={notice === "conflict"}
            >
              继续答题 <ArrowRight size={18} aria-hidden="true" />
            </button>
            <button className={styles.textButton} onClick={clearDemo}>
              <RotateCcw size={16} aria-hidden="true" /> 清除演示书签，重新开始
            </button>
          </section>
        ) : phase === "complete" ? (
          <section
            className={styles.resumeSheet}
            aria-labelledby="complete-title"
          >
            <p className={styles.kicker}>演示到此为止</p>
            <h1 id="complete-title">所有题目已确认</h1>
            <p>
              这是 D1-B 交互验证，没有评分逻辑，因而不会揭晓人物或生成正式报告。
            </p>
            <button className={styles.primaryButton} onClick={clearDemo}>
              重新体验 <RotateCcw size={18} aria-hidden="true" />
            </button>
            <Link
              className={styles.textButton}
              href="/studies/historical/selected/cover"
            >
              <ArrowLeft size={16} aria-hidden="true" /> 回到未揭晓封面
            </Link>
          </section>
        ) : phase === "confirm" ? (
          <section
            className={styles.confirmSheet}
            aria-labelledby="confirm-title"
          >
            <p className={styles.kicker}>落款前核对</p>
            <h1 id="confirm-title">确认这份演示答卷</h1>
            {unanswered.length ? (
              <>
                <p>还有 {unanswered.length} 题未选择。请选择后再完成演示。</p>
                <button
                  className={styles.primaryButton}
                  onClick={() => {
                    setIndex(
                      historicalDemoQuestions.findIndex(
                        (question) => !Number.isInteger(answers[question.id]),
                      ),
                    );
                    setPhase("question");
                  }}
                >
                  回到未完成题目 <ArrowLeft size={18} aria-hidden="true" />
                </button>
              </>
            ) : (
              <>
                <p>
                  12
                  题均已选择。提交后只显示本地演示结束状态，不计算任何人物关系。
                </p>
                <button
                  className={styles.primaryButton}
                  disabled={conflictLocked}
                  onClick={() => {
                    if (conflictLocked) return;
                    if (!storageUnsafe) {
                      try {
                        window.localStorage.removeItem(
                          historicalDemoStorageKey,
                        );
                      } catch {
                        setNotice("save-failed");
                        return;
                      }
                    }
                    setPhase("complete");
                  }}
                >
                  确认完成演示 <ArrowRight size={18} aria-hidden="true" />
                </button>
              </>
            )}
            <button
              className={styles.textButton}
              onClick={() => setPhase("question")}
            >
              返回修改回答
            </button>
          </section>
        ) : (
          <section
            className={styles.questionSheet}
            aria-labelledby="question-heading"
          >
            <div className={styles.questionMeta}>
              <span>
                第 {index + 1} 题 / 共 {historicalDemoQuestions.length} 题
              </span>
              <span>已答 {completed} 题</span>
            </div>
            <div
              className={styles.progressTrack}
              aria-label={`已完成 ${completed} / ${historicalDemoQuestions.length}`}
            >
              <i
                style={{
                  width: `${(completed / historicalDemoQuestions.length) * 100}%`,
                }}
              />
            </div>
            <p className={styles.kicker}>性情小问 · 合成内容</p>
            <h1 id="question-heading" tabIndex={-1}>
              {current.prompt}
            </h1>
            {current.note && <p>{current.note}</p>}
            <fieldset
              className={styles.options}
              role="radiogroup"
              aria-labelledby="answer-instruction"
            >
              <legend id="answer-instruction">
                请选择一项；再次点击已选项可取消。
              </legend>
              {current.options.map((option, optionIndex) => {
                const selected = answers[current.id] === optionIndex;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={selected ? styles.optionSelected : ""}
                    onClick={() => choose(optionIndex)}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowDown" && event.key !== "ArrowUp")
                        return;
                      event.preventDefault();
                      const target =
                        (optionIndex +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          current.options.length) %
                        current.options.length;
                      selectWithKeyboard(target);
                      requestAnimationFrame(() => {
                        document
                          .getElementById(`option-${current.id}-${target}`)
                          ?.focus();
                      });
                    }}
                    id={`option-${current.id}-${optionIndex}`}
                  >
                    <span aria-hidden="true">
                      {selected
                        ? "已选"
                        : ["甲", "乙", "丙", "丁"][optionIndex]}
                    </span>
                    <strong>{option}</strong>
                  </button>
                );
              })}
            </fieldset>
            {!isAnswered && (
              <p className={styles.answerHint} role="status">
                选择一项后才能前往下一题。
              </p>
            )}
            <div className={styles.questionActions}>
              <button
                className={styles.secondaryButton}
                onClick={() => setIndex((value) => Math.max(0, value - 1))}
                disabled={index === 0}
              >
                <ArrowLeft size={18} aria-hidden="true" /> 上一题
              </button>
              <button
                className={styles.primaryButton}
                onClick={goNext}
                disabled={!isAnswered || conflictLocked}
              >
                {index === historicalDemoQuestions.length - 1
                  ? "核对答卷"
                  : "下一题"}{" "}
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            </div>
            <div className={styles.localTools}>
              <Bookmark size={15} aria-hidden="true" />
              <span>
                {storageUnsafe
                  ? "损坏书签仍在浏览器中，当前回答不会覆盖它"
                  : isSaved
                    ? "已暂存到此浏览器"
                    : "当前修改尚未保存"}
              </span>
              <details>
                <summary>查看异常演示</summary>
                <div>
                  <button
                    onClick={() => setStorageEnabled((enabled) => !enabled)}
                  >
                    {storageEnabled ? "模拟保存失败" : "恢复保存"}
                  </button>
                  <button onClick={demoCorrupt}>模拟损坏书签</button>
                  <button onClick={demoConflict}>模拟冲突副本</button>
                </div>
              </details>
            </div>
          </section>
        )}
      </div>
    </SelectedHistoricalShell>
  );
}
