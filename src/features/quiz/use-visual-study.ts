"use client";

import { useEffect, useRef, useState } from "react";
import {
  historicalDemoQuestions as questions,
  historicalDemoVersion,
  readHistoricalDemoProgress,
} from "./historical-demo";

export const visualStudyStorageKey = (direction: string) =>
  `quizforge.visual-v2.${direction}.v1`;

/** Local research controller. Does not score, store results or grant completion. */
export function useVisualStudy(direction: string) {
  const key = visualStudyStorageKey(direction);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<
    "loading" | "resume" | "question" | "confirm"
  >("loading");
  const [notice, setNotice] = useState<
    "corrupt" | "conflict" | "save-failed" | null
  >(null);
  const [corrupt, setCorrupt] = useState(false);
  const [locked, setLocked] = useState(false);
  const [saved, setSaved] = useState(false);
  const initial = useRef(true);
  const question = questions[index]!;
  const count = Object.keys(answers).length;

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const progress = readHistoricalDemoProgress(localStorage.getItem(key));
        if (progress && Object.keys(progress.answers).length) {
          setAnswers(progress.answers);
          const missing = questions.findIndex(
            (q) => !Number.isInteger(progress.answers[q.id]),
          );
          setIndex(missing < 0 ? questions.length - 1 : missing);
          setSaved(true);
          setPhase("resume");
        } else setPhase("question");
      } catch {
        setCorrupt(true);
        setNotice("corrupt");
        setPhase("question");
      }
    });
    const conflict = (event: StorageEvent) => {
      if (
        event.storageArea === localStorage &&
        (event.key === key || event.key === null)
      ) {
        setLocked(true);
        setSaved(false);
        setNotice("conflict");
      }
    };
    window.addEventListener("storage", conflict);
    return () => window.removeEventListener("storage", conflict);
  }, [key]);

  useEffect(() => {
    if (phase !== "question") return;
    if (initial.current && index === 0) {
      initial.current = false;
      return;
    }
    initial.current = false;
    const heading = document.getElementById("v2-question");
    heading?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [index, phase]);

  function save(next = answers) {
    setSaved(false);
    if (locked || corrupt) return false;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          version: historicalDemoVersion,
          answers: next,
          updatedAt: new Date().toISOString(),
        }),
      );
      setSaved(true);
      setNotice(null);
      return true;
    } catch {
      setNotice("save-failed");
      return false;
    }
  }

  function choose(option: number, toggle = true) {
    if (locked) return;
    const next = { ...answers };
    if (toggle && next[question.id] === option) delete next[question.id];
    else next[question.id] = option;
    setAnswers(next);
    save(next);
  }

  function reset() {
    try {
      localStorage.removeItem(key);
    } catch {
      setNotice("save-failed");
      return;
    }
    setAnswers({});
    setIndex(0);
    setSaved(false);
    setCorrupt(false);
    setLocked(false);
    setNotice(null);
    setPhase("question");
  }

  function next() {
    if (locked || !Number.isInteger(answers[question.id])) return;
    if (index === questions.length - 1) setPhase("confirm");
    else setIndex(index + 1);
  }

  return {
    answers,
    index,
    phase,
    question,
    count,
    notice,
    corrupt,
    locked,
    saved,
    choose,
    save,
    reset,
    next,
    previous: () => setIndex(Math.max(0, index - 1)),
    resume: () => {
      if (!locked) setPhase("question");
    },
    edit: () => {
      const missing = questions.findIndex(
        (q) => !Number.isInteger(answers[q.id]),
      );
      if (missing >= 0) setIndex(missing);
      setPhase("question");
    },
    keepLocal: () => {
      setLocked(false);
      setNotice(corrupt ? "corrupt" : null);
    },
  };
}
