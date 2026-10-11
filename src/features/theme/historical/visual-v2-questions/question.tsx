"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ChevronRight,
  LockKeyhole,
} from "lucide-react";
import { historicalDemoQuestions } from "@/features/quiz/historical-demo";
import { useVisualStudy } from "@/features/quiz/use-visual-study";
import {
  galleryRooms,
  galleryQuestionLabels,
  galleryStorageNamespace,
} from "./rooms";
import styles from "./questions.module.css";

export interface CabinetPresentation {
  readonly storageNamespace: string;
  readonly coverHref: string;
  readonly revealHref: string;
  readonly rooms: readonly {
    readonly name: string;
    readonly chapter: string;
    readonly line: string;
    readonly alt: string;
  }[];
  readonly responsiveArt?: boolean;
}

function GalleryScene({
  roomIndex,
  presentation,
}: {
  roomIndex: number;
  presentation?: CabinetPresentation | undefined;
}) {
  const room = (presentation?.rooms ?? galleryRooms)[roomIndex]!;
  const [state, setState] = useState<"loading" | "ready" | "missing">(
    "loading",
  );
  return (
    <aside
      className={styles.scene}
      data-scene
      data-scene-state={state}
      aria-label={room.name}
    >
      {state !== "missing" && (
        <picture>
          {presentation?.responsiveArt && (
            <source
              srcSet={`/assets/themes/historical/visual-v2-c/room-${roomIndex + 1}-480.webp 480w, /assets/themes/historical/visual-v2-c/room-${roomIndex + 1}-960.webp 960w`}
              sizes="(min-width: 900px) 540px, 100vw"
            />
          )}
          <Image
            src={
              presentation?.responsiveArt
                ? `/assets/themes/historical/visual-v2-c/room-${roomIndex + 1}-480.webp`
                : `/assets/themes/historical/visual-v2-questions/room-${roomIndex + 1}.webp`
            }
            alt={room.alt}
            width={1672}
            height={941}
            unoptimized
            loading="eager"
            fetchPriority="high"
            onLoad={() => setState("ready")}
            onError={() => setState("missing")}
          />
        </picture>
      )}
      {state !== "ready" && (
        <p className={styles.sceneStatus} role="status">
          {state === "loading" ? "展厅正在点亮" : "展厅画作暂未呈现"}
        </p>
      )}
      <div className={styles.sceneTitle}>
        <span>
          第{["一", "二", "三", "四"][roomIndex]}厅 · {room.chapter}
        </span>
        <h2>{room.name}</h2>
        <p>{room.line}</p>
      </div>
    </aside>
  );
}

function Notice({ flow }: { flow: ReturnType<typeof useVisualStudy> }) {
  if (!flow.notice) return null;
  return (
    <section className={styles.notice} role="status">
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
          <button onClick={flow.reset}>丢弃损坏书签，重新开始</button>
        )}
        {flow.notice === "save-failed" && !flow.corrupt && (
          <button onClick={() => flow.save()}>重试保存</button>
        )}
      </div>
    </section>
  );
}

export function CabinetQuestions({
  presentation,
}: {
  presentation?: CabinetPresentation;
}) {
  const router = useRouter();
  const flow = useVisualStudy(
    presentation?.storageNamespace ?? galleryStorageNamespace,
  );
  const rooms = presentation?.rooms ?? galleryRooms;
  const roomIndex = Math.floor(flow.index / 3);
  const selected = flow.answers[flow.question.id];
  return (
    <main
      id="main"
      className={styles.shell}
      data-cabinet-questions
      data-converged={presentation ? "true" : undefined}
      data-room={roomIndex}
      data-phase={flow.phase}
    >
      <header className={styles.header}>
        <Link
          href={
            presentation?.coverHref ?? "/studies/visual-v2-questions/research"
          }
          prefetch={false}
          aria-label={presentation ? "返回藏馆封面" : "返回藏馆研究入口"}
        >
          <ArrowLeft size={17} aria-hidden="true" />
        </Link>
        <span>
          千载同心 <small>藏馆探寻</small>
        </span>
        <p>
          <b>{String(flow.index + 1).padStart(2, "0")}</b>
          <span> / 12</span>
        </p>
      </header>
      <div className={styles.layout}>
        <div className={styles.world}>
          <GalleryScene
            key={roomIndex}
            roomIndex={roomIndex}
            presentation={presentation}
          />
          <div className={styles.desktopRooms} aria-hidden="true">
            {rooms.map((room, index) => (
              <div key={room.name} data-current={roomIndex === index}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p>
                  {room.name}
                  <small>{room.chapter}</small>
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.content}>
          {(flow.phase !== "loading" || presentation) && (
            <section
              className={styles.journal}
              aria-label="藏馆行记"
              aria-busy={flow.phase === "loading"}
            >
              <div className={styles.journalHeading}>
                <span>十二枚行记</span>
                {flow.phase === "loading" ? (
                  <p>正在读取行记</p>
                ) : (
                  <p>
                    已点亮 <b>{flow.count}</b> / 12
                  </p>
                )}
              </div>
              <div
                className={styles.marks}
                role="progressbar"
                aria-label="已回答题数"
                aria-valuemin={0}
                aria-valuemax={12}
                aria-valuenow={
                  flow.phase === "loading" ? undefined : flow.count
                }
              >
                {historicalDemoQuestions.map((question, index) => (
                  <span
                    key={question.id}
                    data-question-mark
                    data-answered={Number.isInteger(flow.answers[question.id])}
                    data-current={index === flow.index}
                    aria-hidden="true"
                  >
                    <i>{String(index + 1).padStart(2, "0")}</i>
                  </span>
                ))}
              </div>
            </section>
          )}
          <Notice flow={flow} />
          {flow.phase === "loading" ? (
            <section className={styles.state} role="status" data-loading-state>
              <p className={styles.eyebrow}>一程探寻 · 十二问</p>
              <h1>正在开启藏馆</h1>
              <p>读取这台设备上的进度…</p>
            </section>
          ) : flow.phase === "resume" ? (
            <section className={styles.state}>
              <Bookmark
                className={styles.stateIcon}
                size={32}
                aria-hidden="true"
              />
              <p className={styles.eyebrow}>行记已收好，展厅仍为你亮着</p>
              <h1>接着上次的探寻。</h1>
              <p>已答 {flow.count} / 12 题 · 进度仅在此浏览器</p>
              <button
                className={styles.primary}
                onClick={flow.resume}
                disabled={flow.locked}
              >
                继续探馆
                <ArrowRight size={19} aria-hidden="true" />
              </button>
              <details className={styles.reset}>
                <summary>想从头开始？</summary>
                <p>这会清除本机这份藏馆行记。</p>
                <button onClick={flow.reset}>清除并重新开始</button>
              </details>
            </section>
          ) : flow.phase === "confirm" ? (
            <section className={styles.state}>
              <LockKeyhole
                className={styles.stateIcon}
                size={32}
                aria-hidden="true"
              />
              <p className={styles.eyebrow}>十二问 · 内藏待启</p>
              <h1>
                {flow.count === 12
                  ? "行记齐备，\n此刻相逢。"
                  : "还有问笺，等你落笔。"}
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
                    router.push(
                      presentation?.revealHref ??
                        "/studies/visual-v2-b/celestial/reveal",
                    );
                }}
              >
                查看合成揭晓
                <ArrowRight size={19} aria-hidden="true" />
              </button>
              <button className={styles.secondary} onClick={flow.edit}>
                返回修改回答
              </button>
            </section>
          ) : (
            <section
              className={styles.question}
              data-question-card
              aria-labelledby="v2-question"
            >
              <div className={styles.questionMeta}>
                <p>
                  <span>{String(flow.index + 1).padStart(2, "0")}</span> ·{" "}
                  {galleryQuestionLabels[flow.question.id]}
                </p>
                <span>凭直觉，选一张问笺</span>
              </div>
              <h1 id="v2-question" tabIndex={-1}>
                {flow.question.prompt}
              </h1>
              {flow.question.note && (
                <p className={styles.note}>{flow.question.note}</p>
              )}
              <fieldset
                className={styles.options}
                role="radiogroup"
                aria-labelledby="v2-question"
              >
                <legend className={styles.srOnly}>
                  选择一项，再次点击可取消
                </legend>
                {flow.question.options.map((option, index) => (
                  <button
                    key={option}
                    id={`cabinet-option-${index}`}
                    role="radio"
                    type="button"
                    aria-checked={selected === index}
                    disabled={flow.locked}
                    tabIndex={
                      selected === index ||
                      (selected === undefined && index === 0)
                        ? 0
                        : -1
                    }
                    onClick={() => flow.choose(index)}
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
                      const step = ["ArrowDown", "ArrowRight"].includes(
                        event.key,
                      )
                        ? 1
                        : -1;
                      const target =
                        (index + step + flow.question.options.length) %
                        flow.question.options.length;
                      flow.choose(target, false);
                      document
                        .getElementById(`cabinet-option-${target}`)
                        ?.focus();
                    }}
                  >
                    <span className={styles.optionLabel} aria-hidden="true">
                      <i>{["壹", "贰", "叁", "肆"][index]}</i>
                      <span>
                        {selected === index ? (
                          <Check size={18} />
                        ) : (
                          <span className={styles.emptyMark} />
                        )}
                      </span>
                    </span>
                    <span className={styles.optionText}>{option}</span>
                  </button>
                ))}
              </fieldset>
              <div className={styles.feedback} role="status">
                <Bookmark size={13} aria-hidden="true" />
                <span>
                  {flow.corrupt
                    ? "损坏书签已保留，本次未保存"
                    : flow.locked
                      ? "请先处理进度冲突"
                      : flow.saved
                        ? Number.isInteger(selected)
                          ? "本机已暂存 · 再次点选可取消"
                          : "前面的行记已收好 · 本题尚未选择"
                        : flow.notice === "save-failed"
                          ? "暂存失败，可继续作答"
                          : "没有标准答案，选贴近自己的那一张"}
                </span>
              </div>
              <div className={styles.dock}>
                <button
                  className={styles.previous}
                  disabled={flow.index === 0}
                  onClick={flow.previous}
                >
                  <ArrowLeft size={17} aria-hidden="true" />
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
              <p className={styles.nextRoom}>
                {flow.index % 3 === 2 && flow.index < 11 ? (
                  <>
                    <span>下一厅</span>
                    {rooms[roomIndex + 1]!.name}
                    <ChevronRight size={13} aria-hidden="true" />
                  </>
                ) : (
                  "行记记录作答进度，不代表性格结论"
                )}
              </p>
            </section>
          )}
        </div>
      </div>
      <footer className={styles.footer}>
        娱乐性格测评 · 研究演示 · 非心理诊断
      </footer>
    </main>
  );
}
