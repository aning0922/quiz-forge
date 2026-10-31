"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  Check,
  BookmarkCheck,
  MoreHorizontal,
} from "lucide-react";
import type { ConsumerViewPropsV2 } from "../consumer-v2/interfaces";
import {
  canEditConsumerV2,
  consumerDraftStatusV2,
} from "../consumer-v2/components";
import {
  qianzaiCharacter,
  qianzaiImage,
  qianzaiPrototypeImage,
  qianzaiPreferenceScene,
  type QianzaiVisualProps,
} from "./art";
import { QianzaiWater, QianzaiPetals, useQianzaiMotion } from "./motion";
import { qianzaiArtworkCrop } from "./art-framing";
import styles from "./qianzai.module.css";

export type QianzaiViewProps = ConsumerViewPropsV2 & QianzaiVisualProps;
export const ACTS = [
  { title: "初识本心", place: "灯下问心", line: "灯影渐远 · 风雨将至" },
  { title: "命运抉择", place: "风雨渡口", line: "雨声渐歇 · 星河初明" },
  { title: "归于何处", place: "星河归舟", line: "月色为引 · 故人将至" },
] as const;
export function ArtImage({
  src,
  className = "",
  alt = "",
  asset,
}: {
  src: string | undefined;
  className?: string | undefined;
  alt?: string;
  asset?: { sha256: string; width: number; height: number } | undefined;
}) {
  const [failed, setFailed] = useState(false);
  const crop = asset && qianzaiArtworkCrop(asset);
  return src && !failed && crop && asset ? (
    <svg
      className={className}
      viewBox={`${crop.x} ${crop.y} ${crop.width} ${crop.height}`}
      preserveAspectRatio="xMidYMin slice"
      overflow="hidden"
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      data-qianzai-art-crop
    >
      <image
        href={src}
        width={asset.width}
        height={asset.height}
        onError={() => setFailed(true)}
      />
    </svg>
  ) : src && !failed ? (
    // The compiled resource owner supplies a bounded, decoded local object URL.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
      draggable={false}
    />
  ) : src && failed ? (
    <span className={styles.artMissing} role="status">
      画作暂未呈现，文字与操作仍可使用。
    </span>
  ) : null;
}
export function Screen({
  children,
  name,
  className = "",
  composite = false,
}: {
  children: ReactNode;
  name: string;
  className?: string | undefined;
  composite?: boolean;
}) {
  return (
    <section
      className={`${styles.screen} ${className}`}
      data-qianzai-screen={name}
      data-qianzai-composite={composite || undefined}
    >
      {children}
    </section>
  );
}
export function QianzaiCover({
  model,
  onRead,
  images,
  prototypeImages,
  active,
}: QianzaiViewProps & { active: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [paused, setPaused] = useState(false),
    motion = useQianzaiMotion(active && !paused);
  const image =
    qianzaiImage(model, model.entry?.slots.cover, images) ??
    qianzaiPrototypeImage(model, model.entry?.slots.cover, prototypeImages);
  return (
    <Screen name="cover" className={styles.cover}>
      <div
        className={styles.coverScene}
        data-motion={motion ? "running" : "paused"}
      >
        <ArtImage
          key={image?.objectUrl ?? "none"}
          src={image?.objectUrl}
          className={styles.fullArt}
        />
        {image && <div className={styles.coverIntroShade} aria-hidden="true" />}
        {image && (
          <>
            <div className={styles.lamps} aria-hidden="true">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <i key={i} />
              ))}
            </div>
            <QianzaiWater src={image.objectUrl} active={motion} />
            <QianzaiPetals active={motion} />
          </>
        )}
        {image ? (
          <h1 className={styles.srOnly}>
            {model.entry?.product.title ?? "千载同心"}
          </h1>
        ) : (
          <div className={styles.coverWords}>
            <p className={styles.eyebrow}>在历史长河中 · 遇见另一个你</p>
            <h1>{model.entry?.product.title ?? "千载同心"}</h1>
            <p>一场穿越千年的相遇</p>
          </div>
        )}
        <div className={styles.coverFacts}>
          <p>
            {model.entry?.questions.length ?? 0} 道题 · 三幕旅程 ·
            一场穿越千年的相遇
          </p>
          {!image && <p>依据本轮选择，阅读与你相逢的六卷。</p>}
        </div>
        <button
          className={styles.scrollButton}
          disabled={!canEditConsumerV2(model)}
          onClick={() => onRead("preference")}
        >
          开启穿越之旅
        </button>
        <div className={styles.waterway} aria-hidden="true" />
        <button
          className={styles.swipeHint}
          disabled={!canEditConsumerV2(model)}
          onClick={() => onRead("preference")}
        >
          <span className={styles.swipeUp}>
            <ChevronUp size={24} aria-hidden="true" focusable="false" />
          </span>
          上滑也可启程
        </button>
        <button
          className={styles.motionToggle}
          aria-label="封面动效设置"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <MoreHorizontal size={22} aria-hidden="true" />
        </button>
        {menuOpen && (
          <div className={styles.motionMenu}>
            <button
              aria-pressed={paused}
              onClick={() => {
                setPaused(!paused);
                setMenuOpen(false);
              }}
            >
              {paused ? "继续动效" : "暂停动效"}
            </button>
          </div>
        )}
      </div>
    </Screen>
  );
}

const preferences = {
  male: { title: "男", note: "只匹配男性历史人物" },
  female: { title: "女", note: "只匹配女性历史人物" },
  any: { title: "不选", note: "不限制人物性别" },
};
export function QianzaiPreference({
  model,
  onRead,
  onEnter,
  onChoose,
  images,
  prototypeImages,
}: QianzaiViewProps & {
  onChoose: (value: "male" | "female" | "any") => void;
  onEnter: () => void;
}) {
  const id = useId(),
    selected = model.draft?.matchingContext?.preference,
    preferenceSceneRef = qianzaiPreferenceScene(model),
    scene =
      qianzaiImage(model, preferenceSceneRef, images) ??
      qianzaiPrototypeImage(
        model,
        preferenceSceneRef,
        prototypeImages,
        "prototype-scene-base",
      );
  return (
    <Screen
      name="preference"
      className={styles.preference}
      composite={scene?.layer === "prototype-scene-base"}
    >
      <ArtImage
        key={scene?.objectUrl ?? "none"}
        src={scene?.objectUrl}
        className={styles.fullArt}
      />
      <header className={styles.topbar}>
        <button onClick={() => onRead("cover")} aria-label="返回封面">
          <ChevronLeft aria-hidden="true" />
        </button>
        <span>
          QuizForge<sup>＋</sup>
        </span>
      </header>
      <div className={styles.preferenceHeading}>
        <p className={styles.eyebrow}>启程引子</p>
        <h1>
          这一程，
          <br />
          你想与谁相逢？
        </h1>
        <p>请选择希望匹配的历史人物性别</p>
        <p className={styles.preferenceNotice}>
          此选择不代表你的性别，不改变五维分数。
        </p>
      </div>
      <div className={styles.preferenceBody} data-qianzai-scroll-region>
        <div className={styles.preferenceControls}>
          {scene?.layer === "prototype-scene-base" && (
            <svg
              className={styles.preferenceLowerArt}
              viewBox="0 393 390 451"
              aria-hidden="true"
            >
              <image href={scene.objectUrl} width="390" height="844" />
            </svg>
          )}
          <fieldset
            className={styles.preferences}
            disabled={!canEditConsumerV2(model)}
          >
            <legend className={styles.srOnly}>目标人物偏好</legend>
            {(model.entry?.preferences ?? []).map((value) => (
              <label
                key={value}
                className={styles.preferenceChoice}
                data-selected={selected === value}
              >
                <input
                  name={id}
                  type="radio"
                  value={value}
                  aria-label={preferences[value].note}
                  checked={selected === value}
                  onChange={() => onChoose(value)}
                />
                <span
                  className={styles.preferencePortrait}
                  aria-hidden="true"
                />
                <strong>{preferences[value].title}</strong>
                <span className={styles.preferenceNote}>
                  {preferences[value].note}
                </span>
                <span className={styles.radioMark} aria-hidden="true">
                  {selected === value && <Check size={20} strokeWidth={3} />}
                </span>
              </label>
            ))}
          </fieldset>
          <button
            className={styles.primary}
            disabled={!canEditConsumerV2(model) || !selected}
            onClick={onEnter}
          >
            进入第一幕
          </button>
          <p className={styles.finePrint}>
            下一步将开启 {model.entry?.questions.length ?? 0} 道测试题
            <br />
            探寻你与TA的命定相逢
          </p>
          {scene?.layer === "prototype-scene-base" && (
            <span className={styles.preferenceCount} aria-hidden="true">
              {model.entry?.questions.length ?? 0}
            </span>
          )}
        </div>
      </div>
    </Screen>
  );
}

export function QianzaiQuestion({
  model,
  onEvent,
  onRead,
  images,
  onChoose,
  readingQuestionId,
  prototypeImages,
}: QianzaiViewProps & {
  onChoose: (questionId: string, optionId: string) => void;
  readingQuestionId?: string;
}) {
  const bodyPort = useRef<HTMLDivElement>(null),
    acceptedPosition = useRef<string | null>(null);
  useLayoutEffect(() => {
    const next = model.state?.progress.questionId;
    if (model.phase === "ready" && next && next !== acceptedPosition.current) {
      acceptedPosition.current = next;
      if (bodyPort.current) bodyPort.current.scrollTop = 0;
    }
  }, [model.phase, model.state?.progress.questionId]);
  const id = useId(),
    questions = model.entry?.questions ?? [];
  const index = questions.findIndex(
      (q) =>
        q.ref.id === (readingQuestionId ?? model.draft?.progress.questionId),
    ),
    q = questions[index];
  const act = q?.act ?? 1,
    scene = model.entry?.slots.acts[act - 1],
    cleanArt = qianzaiImage(model, scene?.background, images);
  const prototypeBase = qianzaiPrototypeImage(
      model,
      scene?.background,
      prototypeImages,
    ),
    idle =
      qianzaiImage(model, scene?.optionIdle, images) ??
      qianzaiPrototypeImage(
        model,
        scene?.optionIdle,
        prototypeImages,
        "prototype-option-skin",
        { act },
      ),
    chosenSkin =
      qianzaiImage(model, scene?.optionSelected, images) ??
      qianzaiPrototypeImage(
        model,
        scene?.optionSelected,
        prototypeImages,
        "prototype-option-skin",
        { act },
      );
  const cover =
    qianzaiImage(model, model.entry?.slots.cover, images) ??
    qianzaiPrototypeImage(model, model.entry?.slots.cover, prototypeImages);
  // Fixed, reviewed V8 derivative. This is shared water scenery, not an
  // original clean background for any of the three acts. The owner still
  // verifies/adopts the whole neutral.cover; no arbitrary crop comes from a pack.
  const water =
    cover?.asset.width === 852 && cover.asset.height === 1844
      ? cover
      : undefined;
  const paper = qianzaiImage(model, scene?.questionPaper, images),
    enabled = canEditConsumerV2(model) && !!model.draft?.matchingContext;
  // Never expose a base containing old question/answer UI until its full dynamic
  // composition is decoded. Authority loss removes the entry at the owner.
  const art =
    cleanArt ?? (paper && idle && chosenSkin && q ? prototypeBase : undefined);
  const selected = model.draft?.answers.find(
    (a) => a.questionId === q?.ref.id,
  )?.optionId;
  const saved = consumerDraftStatusV2(model);
  const confirmedSaved =
    canEditConsumerV2(model) &&
    model.pendingOperation === null &&
    saved.preferenceSaved &&
    saved.answersSaved &&
    saved.progressSaved;
  return (
    <Screen
      name="question"
      className={styles.question}
      composite={art?.layer === "prototype-scene-base"}
    >
      <ArtImage
        key={art?.objectUrl ?? "none"}
        src={art?.objectUrl}
        className={styles.fullArt}
      />
      {art?.layer === "prototype-scene-base" && (
        <svg
          className={styles.sceneMusicMask}
          viewBox="0 0 390 844"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <svg
            x="289"
            y="30"
            width="50"
            height="55"
            viewBox="289 85 50 30"
            preserveAspectRatio="none"
            overflow="hidden"
          >
            <image href={art.objectUrl} width="390" height="844" />
          </svg>
        </svg>
      )}
      {water && (
        <svg
          className={styles.answerBackdrop}
          viewBox="0 0 852 444"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <svg
            width="852"
            height="444"
            viewBox="0 1400 852 444"
            overflow="hidden"
          >
            <image href={water.objectUrl} width="852" height="1844" />
          </svg>
        </svg>
      )}
      <header className={styles.topbar}>
        <button
          disabled={!enabled}
          onClick={() => onRead("preference")}
          aria-label="偏好"
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <span className={styles.wordmark}>
          千载同心<i aria-hidden="true">古风</i>
        </span>
        <button
          disabled={!enabled}
          onClick={() => onRead("resume")}
          aria-label="旅程"
        >
          <MoreHorizontal aria-hidden="true" />
        </button>
      </header>
      {q ? (
        <>
          <div className={styles.actScene} data-act={act}>
            <p>第{["一", "二", "三"][act - 1] ?? act}幕</p>
            <h1>{ACTS[act - 1]?.title}</h1>
            <span>{ACTS[act - 1]?.place}</span>
          </div>
          <div className={styles.questionProgress}>
            <div
              role="progressbar"
              aria-label="答题位置"
              aria-valuemin={0}
              aria-valuemax={questions.length}
              aria-valuenow={index + 1}
            >
              <i
                style={{ width: `${((index + 1) / questions.length) * 100}%` }}
              />
            </div>
            <span>
              {index + 1} / {questions.length}
            </span>
            <span className={styles.progressReceipt} role="status">
              <BookmarkCheck size={15} aria-hidden="true" />
              {confirmedSaved
                ? "已保存"
                : model.phase === "saving"
                  ? "保存中"
                  : ["unknown", "conflict", "unavailable"].includes(model.phase)
                    ? "待核实"
                    : "本轮选择"}
            </span>
          </div>
          <div
            className={styles.questionBody}
            ref={bodyPort}
            data-qianzai-scroll-region
          >
            <div
              className={styles.questionPaper}
              data-long={q.prompt.length >= 30}
              style={
                paper
                  ? {
                      backgroundImage: `url("${paper.objectUrl}")`,
                    }
                  : undefined
              }
            >
              <h2>{q.prompt}</h2>
            </div>
            <fieldset className={styles.options} disabled={!enabled}>
              <legend className={styles.srOnly}>选择本轮想法</legend>
              {q.options.map((option, i) => {
                const chosen = selected === option.ref.id,
                  skin = chosen ? chosenSkin : idle;
                return (
                  <label
                    key={option.ref.id}
                    className={styles.option}
                    data-selected={chosen}
                    style={
                      skin
                        ? {
                            backgroundImage: `url("${skin.objectUrl}")`,
                          }
                        : undefined
                    }
                  >
                    {chosen &&
                      skin &&
                      art?.layer === "prototype-scene-base" && (
                        <svg
                          className={styles.optionSealMask}
                          viewBox="0 0 355 65"
                          preserveAspectRatio="none"
                          aria-hidden="true"
                        >
                          <svg
                            x="291"
                            y="12"
                            width="43"
                            height="42"
                            viewBox="253 12 24 42"
                            preserveAspectRatio="none"
                            overflow="hidden"
                          >
                            <image
                              href={skin.objectUrl}
                              width="355"
                              height="65"
                            />
                          </svg>
                        </svg>
                      )}
                    <input
                      type="radio"
                      name={id}
                      value={option.ref.id}
                      checked={chosen}
                      onChange={() => onChoose(q.ref.id, option.ref.id)}
                    />
                    <span className={styles.optionLetter} aria-hidden="true">
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span>
                      {(
                        option.label.match(
                          /[^，。；！？、：]+[，。；！？、：]?|[，。；！？、：]/gu,
                        ) ?? [option.label]
                      ).map((phrase, part) => (
                        <span key={part} className={styles.optionPhrase}>
                          {phrase}
                        </span>
                      ))}
                    </span>
                    <span
                      className={styles.optionCheck}
                      aria-hidden="true"
                      data-visible={chosen}
                    >
                      {chosen && <Check size={18} strokeWidth={3} />}
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <nav className={styles.questionNav} aria-label="答题导航">
              <button
                style={
                  art?.layer === "prototype-scene-base"
                    ? {
                        backgroundImage: `url("${art.objectUrl}")`,
                        backgroundSize:
                          "var(--scene-width) calc(var(--scene-width) * 844 / 390)",
                        backgroundPosition:
                          "calc(var(--scene-width) * -18 / 390) calc(var(--scene-width) * -751 / 390)",
                      }
                    : undefined
                }
                disabled={!enabled || index < 1}
                onClick={() =>
                  onEvent({
                    type: "navigate",
                    questionId: questions[index - 1]!.ref.id,
                  })
                }
              >
                上一题
              </button>
              <p
                className={styles.saveNote}
                role="status"
                data-live={
                  model.phase === "saving" ||
                  ["unknown", "conflict", "unavailable"].includes(model.phase)
                }
              >
                {model.phase === "saving"
                  ? "正在保存…"
                  : ["unknown", "conflict", "unavailable"].includes(model.phase)
                    ? "选择已保留，等待核对"
                    : "可随时修改答案"}
              </p>
              <button
                style={
                  art?.layer === "prototype-scene-base"
                    ? {
                        backgroundImage: `url("${art.objectUrl}")`,
                        backgroundSize:
                          "var(--scene-width) calc(var(--scene-width) * 844 / 390)",
                        backgroundPosition:
                          "calc(var(--scene-width) * -251 / 390) calc(var(--scene-width) * -751 / 390)",
                      }
                    : undefined
                }
                disabled={!enabled || !selected}
                onClick={() => {
                  if (index < questions.length - 1)
                    onEvent({
                      type: "navigate",
                      questionId: questions[index + 1]!.ref.id,
                    });
                  else if (selected) onChoose(q.ref.id, selected);
                }}
              >
                {index === questions.length - 1 &&
                  art?.layer === "prototype-scene-base" && (
                    <svg
                      className={styles.buttonCaptionPatch}
                      viewBox="0 0 122 62"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <svg
                        x="11"
                        y="16"
                        width="82"
                        height="31"
                        viewBox="275 790 66 8"
                        preserveAspectRatio="none"
                        overflow="hidden"
                      >
                        <image href={art.objectUrl} width="390" height="844" />
                      </svg>
                    </svg>
                  )}
                <span data-final={index === questions.length - 1}>
                  {index === questions.length - 1 ? "走向相逢" : "下一题"}
                </span>
              </button>
            </nav>
          </div>
        </>
      ) : (
        <div className={styles.empty}>
          <h1>旅程正在展开</h1>
          <p>读取已保存的位置后继续。</p>
        </div>
      )}
    </Screen>
  );
}

export function QianzaiReveal({
  model,
  onRead,
  images,
  active = true,
  presentation = "ready",
  startedAt = 0,
  onReplay,
}: QianzaiViewProps & {
  active?: boolean;
  presentation?: "waiting" | "playing" | "ready";
  startedAt?: number;
  onReplay?: () => void;
}) {
  const character = qianzaiCharacter(model),
    image = qianzaiImage(model, character?.reveal, images),
    name = qianzaiImage(model, character?.nameArt, images);
  const body = model.report?.view.display.body,
    selected = body?.matching.selected;
  const sealedLine = body?.volumes
    .find((v) => v.id === "encounter")
    ?.paragraphs.find(
      (p) =>
        p.kind === "literary" &&
        p.status === "accepted" &&
        Array.from(p.text).length <= 96,
    );
  const layers = useRef<HTMLDivElement>(null),
    motion = useQianzaiMotion(active);
  useEffect(() => {
    if (presentation !== "playing" || !startedAt || !layers.current) return;
    // Late decoded resources join the current reveal clock. They never restart
    // a finished reveal or delay access to the immutable text report.
    const elapsed = Math.max(0, performance.now() - startedAt);
    for (const animation of layers.current.getAnimations({ subtree: true })) {
      if (Number.isFinite(animation.effect?.getComputedTiming().endTime))
        animation.currentTime = Math.max(
          Number(animation.currentTime ?? 0),
          elapsed,
        );
    }
  }, [image?.objectUrl, name?.objectUrl, presentation, startedAt]);
  return (
    <Screen name="result" className={styles.reveal}>
      <div
        ref={layers}
        className={styles.revealLayers}
        data-reveal-phase={presentation}
        data-motion={motion ? "running" : "paused"}
        aria-hidden={presentation === "waiting"}
      >
        <ArtImage
          key={image?.objectUrl ?? "none"}
          src={image?.objectUrl}
          asset={image?.asset}
          className={styles.revealArt}
        />
        <div className={styles.revealShade} aria-hidden="true" />
        <div className={styles.moonbeam} aria-hidden="true" />
        <div className={styles.inkSweep} aria-hidden="true" />
        <header className={styles.revealHeader}>
          <p>
            千载同心<i aria-hidden="true">古风</i>
          </p>
          <span>终章 · 命定相逢</span>
        </header>
        {onReplay && (
          <details className={styles.revealMenu}>
            <summary aria-label="揭晓选项">
              <MoreHorizontal size={22} aria-hidden="true" />
            </summary>
            <nav aria-label="相逢阅读">
              <button
                onClick={(event) => {
                  event.currentTarget
                    .closest("details")
                    ?.removeAttribute("open");
                  onReplay();
                }}
              >
                重新播放揭晓
              </button>
              <button onClick={() => onRead("report")}>阅读人物报告</button>
            </nav>
          </details>
        )}
        <div className={styles.revealIdentity} data-qianzai-scroll-region>
          <p>与你相逢的是</p>
          <div className={styles.revealNameFrame}>
            {name && name.asset.approval !== "private-test-only" ? (
              <>
                <ArtImage
                  key={name.objectUrl}
                  src={name.objectUrl}
                  className={styles.nameArt}
                />
                <h1 className={styles.srOnly}>{selected?.label}</h1>
              </>
            ) : (
              <h1
                className={styles.diagonalName}
                data-name-size={Array.from(selected?.label ?? "").length}
              >
                {Array.from(selected?.label ?? "本轮相逢").map((letter, i) => (
                  <span key={i}>{letter}</span>
                ))}
              </h1>
            )}
          </div>
          {sealedLine && (
            <p className={styles.revealSealedLine}>{sealedLine.text}</p>
          )}
        </div>
        <button
          data-reveal-continue
          className={styles.revealContinue}
          disabled={!body || model.phase !== "completed"}
          onClick={() => onRead("report")}
        >
          <ChevronDown size={30} aria-hidden="true" focusable="false" />
          下滑查看人物报告
        </button>
      </div>
    </Screen>
  );
}
