"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type CSSProperties,
} from "react";
import type { ConsumerViewPropsV2 } from "../consumer-v2/interfaces";
import {
  canEditConsumerV2,
  consumerDraftStatusV2,
} from "../consumer-v2/components";
import {
  qianzaiRoleComposite,
  qianzaiImage,
  qianzaiPrototypeImage,
  qianzaiPreferenceScene,
  qianzaiCharacter,
  sameArtRef,
  type QianzaiVisualProps,
} from "./art";
import { QianzaiWater, QianzaiPetals, useQianzaiMotion } from "./motion";
import { qianzaiArtworkCrop } from "./art-framing";
import { useQianzaiExport } from "./export-context";
import styles from "./qianzai.module.css";
import scenes from "./scenes.module.css";

export type QianzaiViewProps = ConsumerViewPropsV2 & QianzaiVisualProps;
function TestingNote({ model }: Pick<QianzaiViewProps, "model">) {
  const assets = model.report?.view.display.assets ?? model.entry?.assets ?? [];
  return assets.some((a) => a.approval === "private-test-only") ? (
    <p className={scenes.artNote}>
      本机测试使用参考素材与候选正文，尚非最终商品版本。
    </p>
  ) : null;
}
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
  const [failed, setFailed] = useState(false),
    crop = asset && qianzaiArtworkCrop(asset);
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
    // Resource owners supply decoded, scoped local object URLs.
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
/** The source five-screen prototype scales its fixed canvas as one composition. */
export function useQianzaiSceneScale() {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const resize = () => {
      const mobile = window.innerWidth <= 750;
      setScale(
        Math.max(
          0.55,
          Math.min(
            mobile ? 1.13 : 1,
            Math.min(window.innerWidth, 430) / 390,
            (window.innerHeight - (mobile ? 0 : 50)) / 844,
          ),
        ),
      );
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return scale;
}
function Scene({
  name,
  className,
  children,
  composite = false,
  motion,
  focus,
  reduced,
  fluid = false,
}: {
  focus?: string;
  reduced?: boolean;
  fluid?: boolean;
  motion?: boolean;
  name: string;
  className: string | undefined;
  children: ReactNode;
  composite?: boolean;
}) {
  const scale = useQianzaiSceneScale();
  return (
    <section
      className={scenes.frame}
      style={
        fluid
          ? { width: "min(100%, 430px)", height: "100dvh" }
          : name === "cover"
            ? undefined
            : name === "question"
              ? ({
                  "--scene-unit": "min(1.102564px, 100vw / 390)",
                } as CSSProperties)
              : { width: 390 * scale, height: 844 * scale }
      }
      data-responsive-cover={name === "cover" || undefined}
      data-responsive-question={name === "question" || undefined}
      data-responsive-reveal={fluid || undefined}
      data-qianzai-screen={name}
      data-qianzai-composite={composite || undefined}
    >
      <div
        className={`${scenes.canvas} ${className}`}
        style={
          fluid || name === "cover" || name === "question"
            ? { width: "100%", height: "100%" }
            : { transform: `scale(${scale})` }
        }
        data-qianzai-scene-canvas
        data-focus={focus}
        data-reduced={reduced || undefined}
        data-motion={
          motion === undefined ? undefined : motion ? "running" : "paused"
        }
      >
        {children}
      </div>
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
  const [menuOpen, setMenuOpen] = useState(false),
    [paused, setPaused] = useState(false),
    [manualReduced, setManualReduced] = useState<boolean | null>(null),
    [focus, setFocus] = useState("all"),
    [replay, setReplay] = useState(0);
  const systemReduced = useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  const reduced = manualReduced ?? systemReduced,
    motion = useQianzaiMotion(active && !paused && !reduced);
  const image =
    qianzaiImage(model, model.entry?.slots.cover, images) ??
    qianzaiPrototypeImage(model, model.entry?.slots.cover, prototypeImages);
  return (
    <Scene
      name="cover"
      motion={motion}
      focus={focus}
      reduced={reduced}
      className={scenes.coverV8}
      composite={image?.layer === "prototype-scene-base"}
    >
      {image ? (
        <>
          <ArtImage
            key={`${image.objectUrl}:${replay}`}
            src={image.objectUrl}
            className={scenes.coverArt}
          />
          <div className={scenes.introShade} />
          <div className={scenes.lampCluster} aria-hidden="true">
            {[
              "tower",
              "tower2",
              "tower3",
              "riverLeft",
              "riverRight",
              "foreground",
            ].map((kind) => (
              <i key={kind} className={`${scenes.lamp} ${scenes[kind]}`} />
            ))}
          </div>
          <QianzaiWater
            key={`water:${replay}`}
            src={image.objectUrl}
            active={motion && (focus === "all" || focus === "water")}
          />
          <QianzaiPetals
            key={`petals:${replay}`}
            active={motion && (focus === "all" || focus === "petals")}
          />
          {model.entry?.questions.length !== 12 && (
            <span className={scenes.coverCount}>
              {model.entry?.questions.length}
            </span>
          )}
        </>
      ) : (
        <div className={scenes.empty}>
          <h1>{model.entry?.product.title ?? "千载同心"}</h1>
          <p>场景素材尚未就绪，仍可继续旅程。</p>
        </div>
      )}
      <h1 className={scenes.srOnly}>
        {model.entry?.product.title ?? "千载同心"}
      </h1>
      <button
        className={scenes.cta}
        disabled={!canEditConsumerV2(model)}
        aria-label="开启穿越之旅"
        onClick={() => onRead("preference")}
      />
      <div className={scenes.waterway} aria-hidden="true" />
      <button
        className={scenes.swipeHint}
        disabled={!canEditConsumerV2(model)}
        onClick={() => onRead("preference")}
      >
        <span className={scenes.up}>⌃</span>上滑也可启程
      </button>
      <button
        className={scenes.motionToggle}
        aria-label="封面动效设置"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(!menuOpen)}
      >
        ⋯
      </button>
      {menuOpen && (
        <div className={scenes.settingsPop}>
          <TestingNote model={model} />
          <button
            onClick={() => {
              setReplay((old) => old + 1);
              setMenuOpen(false);
            }}
          >
            ↻ 重播封面
          </button>
          <button
            onClick={() => {
              setPaused(!paused);
              setMenuOpen(false);
            }}
          >
            {paused ? "▶ 继续环境动效" : "Ⅱ 暂停环境动效"}
          </button>
          <button
            onClick={() => {
              setManualReduced(!reduced);
              setMenuOpen(false);
            }}
          >
            {reduced ? "◇ 开启完整动效" : "◇ 减少动态效果"}
          </button>
          {(["all", "petals", "lantern", "water"] as const).map((kind) => (
            <button
              key={kind}
              aria-pressed={focus === kind}
              onClick={() => {
                setFocus(kind === focus && kind !== "all" ? "all" : kind);
                setMenuOpen(false);
              }}
            >
              {
                {
                  all: "三种效果一起看",
                  petals: "❀ 单独看花瓣",
                  lantern: "✦ 单独看灯影",
                  water: "≈ 单独看水面",
                }[kind]
              }
            </button>
          ))}
        </div>
      )}
    </Scene>
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
    [selectionRequired, setSelectionRequired] = useState(false),
    choices = useRef<HTMLFieldSetElement>(null),
    selected = model.draft?.matchingContext?.preference,
    ref = qianzaiPreferenceScene(model),
    image =
      qianzaiImage(model, ref, images) ??
      qianzaiPrototypeImage(model, ref, prototypeImages);
  const [feedback, setFeedback] = useState(false),
    feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
    },
    [],
  );
  const flash = () => {
    setFeedback(true);
    if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => {
      feedbackTimer.current = null;
      setFeedback(false);
    }, 400);
  };
  return (
    <Scene
      name="preference"
      className={`${scenes.gender} ${feedback ? scenes.leaving : ""}`}
      composite={image?.layer === "prototype-scene-base"}
    >
      {image ? (
        <ArtImage
          key={image.objectUrl}
          src={image.objectUrl}
          className={scenes.art}
        />
      ) : (
        <div className={scenes.empty}>
          <h1>这一程，你想与谁相逢？</h1>
        </div>
      )}
      <div className={scenes.flash} aria-hidden="true" />
      <button
        className={`${scenes.interact} ${scenes["gender-back"]}`}
        aria-label="返回封面"
        onClick={() => onRead("cover")}
      />
      <fieldset
        ref={choices}
        className={scenes.options}
        disabled={!canEditConsumerV2(model)}
        aria-describedby={selectionRequired ? `${id}-required` : undefined}
        tabIndex={-1}
      >
        <legend className={scenes.srOnly}>
          希望匹配的历史人物性别，不代表你的性别，不改变五维分数
        </legend>
        {(model.entry?.preferences ?? []).map((value) => (
          <label
            key={value}
            className={`${scenes.choice} ${scenes.interact} ${selected === value ? scenes.picked : ""}`}
            data-choice={value === "any" ? "none" : value}
            data-selected={selected === value}
          >
            <input
              className={scenes.srOnly}
              name={id}
              type="radio"
              value={value}
              checked={selected === value}
              onChange={() => {
                setSelectionRequired(false);
                flash();
                onChoose(value);
              }}
              aria-label={`${preferences[value].title}，${preferences[value].note}`}
            />
            {!image && (
              <span>
                {preferences[value].title} · {preferences[value].note}
              </span>
            )}
          </label>
        ))}
      </fieldset>
      {(model.entry?.preferences ?? []).map((value) => (
        <span
          key={value}
          className={`${scenes.dot} ${selected === value ? scenes.picked : ""}`}
          data-choice={value === "any" ? "none" : value}
          aria-hidden="true"
        />
      ))}
      {selectionRequired && (
        <p
          id={`${id}-required`}
          className={scenes.preferenceRequired}
          role="alert"
        >
          请先选择希望匹配的人物性别
        </p>
      )}
      <button
        className={`${scenes.enter} ${scenes.interact}`}
        disabled={!canEditConsumerV2(model)}
        aria-label="进入第一幕"
        onClick={() => {
          if (!selected) {
            setSelectionRequired(true);
            choices.current?.focus({ preventScroll: true });
            return;
          }
          flash();
          onEnter();
        }}
      />
      {model.entry?.questions.length !== 12 && (
        <span className={scenes.preferenceCount}>
          {model.entry?.questions.length}
        </span>
      )}
    </Scene>
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
  const id = useId(),
    [menuOpen, setMenuOpen] = useState(false),
    [musicNotice, setMusicNotice] = useState(false),
    bodyPort = useRef<HTMLDivElement>(null),
    acceptedPosition = useRef<string | null>(null);
  useLayoutEffect(() => {
    const next = model.state?.progress.questionId;
    if (model.phase === "ready" && next && next !== acceptedPosition.current) {
      acceptedPosition.current = next;
      if (bodyPort.current) bodyPort.current.scrollTop = 0;
    }
  }, [model.phase, model.state?.progress.questionId]);
  const questions = model.entry?.questions ?? [],
    index = questions.findIndex(
      (q) =>
        q.ref.id === (readingQuestionId ?? model.draft?.progress.questionId),
    ),
    q = questions[index],
    act = q?.act ?? 1,
    scene = model.entry?.slots.acts[act - 1];
  const paper = qianzaiImage(model, scene?.questionPaper, images),
    idle =
      qianzaiImage(model, scene?.optionIdle, images) ??
      qianzaiPrototypeImage(
        model,
        scene?.optionIdle,
        prototypeImages,
        "prototype-option-skin",
        { act },
      ),
    chosen =
      qianzaiImage(model, scene?.optionSelected, images) ??
      qianzaiPrototypeImage(
        model,
        scene?.optionSelected,
        prototypeImages,
        "prototype-option-skin",
        { act },
      );
  const art =
    qianzaiImage(model, scene?.background, images) ??
    (paper && idle && chosen && q
      ? qianzaiPrototypeImage(model, scene?.background, prototypeImages)
      : undefined);
  const selected = model.draft?.answers.find(
      (a) => a.questionId === q?.ref.id,
    )?.optionId,
    enabled = canEditConsumerV2(model) && !!model.draft?.matchingContext,
    saved = consumerDraftStatusV2(model),
    confirmed =
      canEditConsumerV2(model) &&
      model.pendingOperation === null &&
      saved.preferenceSaved &&
      saved.answersSaved &&
      saved.progressSaved;
  const previous = () =>
    index > 0
      ? onEvent({ type: "navigate", questionId: questions[index - 1]!.ref.id })
      : onRead("preference");
  return (
    <Scene
      name="question"
      className={scenes.quiz}
      composite={art?.layer === "prototype-scene-base"}
    >
      {art && q ? (
        <>
          <ArtImage
            key={art.objectUrl}
            src={art.objectUrl}
            className={scenes["scene-art"]}
          />
          <div className={scenes.readable} />
          <svg className={scenes.answerTexture} aria-hidden="true">
            <defs>
              <pattern
                id={`${id}-water`}
                patternUnits="userSpaceOnUse"
                width="390"
                height="34"
              >
                <image href={art.objectUrl} y="-810" width="390" height="844" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#${id}-water)`} />
          </svg>
          <div className={scenes["progress-cover"]} />
          <div className={scenes["progress-track"]}>
            <div
              className={scenes["progress-done"]}
              style={{ width: `${((index + 1) / questions.length) * 100}%` }}
            />
          </div>
          <div className={scenes["progress-num"]}>
            {index + 1} / {questions.length}
          </div>
          {!confirmed && (
            <span className={scenes.saveStatus} role="status">
              {model.phase === "saving"
                ? "保存中"
                : ["unknown", "conflict", "unavailable"].includes(model.phase)
                  ? "待核对"
                  : "本轮选择"}
            </span>
          )}
          <button
            className={`${scenes.interact} ${scenes["hit-top"]} ${scenes.back}`}
            disabled={!enabled}
            aria-label="上一页"
            onClick={previous}
          />
          <button
            className={`${scenes.interact} ${scenes["hit-top"]} ${scenes.music}`}
            aria-label="音乐说明"
            onClick={() => setMusicNotice(!musicNotice)}
          />
          <button
            className={`${scenes.interact} ${scenes["hit-top"]} ${scenes.menu}`}
            aria-label="更多选项"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(!menuOpen)}
          />
          <div
            ref={bodyPort}
            className={scenes.questionFlow}
            data-qianzai-scroll-region
          >
            <div className={scenes.questionStack}>
              <ArtImage
                src={paper?.objectUrl}
                className={scenes["question-panel"]}
              />
              <h2 className={scenes["question-text"]}>{q.prompt}</h2>
              <fieldset className={scenes.options} disabled={!enabled}>
                <legend className={scenes.srOnly}>选择本轮想法</legend>
                {q.options.map((option, i) => {
                  const checked = selected === option.ref.id,
                    skin = checked ? chosen : idle;
                  return (
                    <label
                      key={option.ref.id}
                      className={`${scenes.option} ${checked ? scenes.active : ""}`}
                      data-selected={checked}
                      style={{ top: 174 + i * 76 }}
                    >
                      <ArtImage src={skin?.objectUrl} className={scenes.skin} />
                      <input
                        name={id}
                        type="radio"
                        value={option.ref.id}
                        checked={checked}
                        onChange={() => onChoose(q.ref.id, option.ref.id)}
                        aria-label={`${String.fromCharCode(65 + i)} ${option.label}`}
                      />
                      <span className={scenes.letter} aria-hidden="true">
                        {String.fromCharCode(65 + i)}
                      </span>
                      <span className={scenes.words}>{option.label}</span>
                      <span className={scenes.check} aria-hidden="true">
                        ✓
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            </div>
          </div>
          <button
            className={`${scenes.interact} ${scenes.foot} ${scenes.prev}`}
            disabled={!enabled}
            aria-label="上一题"
            onClick={previous}
          >
            <svg
              viewBox="18 751 114 62"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <image href={art.objectUrl} width="390" height="844" />
            </svg>
          </button>
          <button
            className={`${scenes.interact} ${scenes.foot} ${scenes.next}`}
            disabled={!enabled || !selected}
            aria-label={
              index === questions.length - 1
                ? "确认最后选择，走向相逢"
                : "下一题"
            }
            onClick={() => {
              if (index < questions.length - 1)
                onEvent({
                  type: "navigate",
                  questionId: questions[index + 1]!.ref.id,
                });
              else if (selected) onChoose(q.ref.id, selected);
            }}
          >
            <svg
              viewBox="251 751 122 62"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <image href={art.objectUrl} width="390" height="844" />
            </svg>
          </button>
          {menuOpen && (
            <div className={`${scenes["menu-panel"]} ${scenes.visible}`}>
              <TestingNote model={model} />
              <button
                disabled={!enabled}
                onClick={() => {
                  setMenuOpen(false);
                  onRead("cover");
                }}
              >
                返回封面
              </button>
              <button
                disabled={!enabled}
                onClick={() => {
                  setMenuOpen(false);
                  onRead("preference");
                }}
              >
                性别选择
              </button>
              <button
                disabled={!enabled}
                onClick={() => {
                  setMenuOpen(false);
                  onRead("resume");
                }}
              >
                查看本轮进度
              </button>
            </div>
          )}
          {musicNotice && (
            <p className={scenes.musicNotice} role="status">
              当前未提供音轨。
            </p>
          )}
        </>
      ) : (
        <div className={scenes.empty}>
          <h1>旅程正在展开</h1>
          <p>等待当前固定场景及题目资源就绪。</p>
        </div>
      )}
    </Scene>
  );
}

/** Deliberately separate from runtime visual props: exact original HTML pixels
 * are available only in the labelled, non-business reference comparison. The
 * controller/runtime never constructs or persists this reference fixture. */
export type QianzaiRevealReference = Readonly<{
  mode: "reference-only";
  before: Readonly<{
    sha256: "778e1ae1817fc53840d4478cbcd0e6074daba6e3febe7456801066a4a396db38";
    objectUrl: `blob:${string}`;
  }>;
  full: Readonly<{
    sha256: "08ed543b80e55e4a5c3d02819270cf87c216bdc370e78465aba6c9b48ad9c425";
    objectUrl: `blob:${string}`;
  }>;
}>;
export function QianzaiReveal({
  model,
  onRead,
  active = true,
  presentation = "ready",
  startedAt = 0,
  onReplay,
  referenceComposite,
  roleCompositeImages,
  images,
}: QianzaiViewProps & {
  active?: boolean;
  presentation?: "waiting" | "playing" | "ready";
  startedAt?: number;
  onReplay?: () => void;
  referenceComposite?: QianzaiRevealReference;
}) {
  const selected = model.report?.view.display.body.matching.selected;
  const result = useQianzaiExport().getResultPresentation();
  const character = qianzaiCharacter(model);
  const currentCharacter =
    model.phase === "completed" &&
    model.pendingOperation === null &&
    selected &&
    character &&
    sameArtRef(character.resultRef, selected.ref)
      ? character
      : undefined;
  const portrait = qianzaiImage(model, currentCharacter?.reveal, images);
  const nameArt = qianzaiImage(model, currentCharacter?.nameArt, images);
  const copy =
    result && selected && sameArtRef(result.role.ref, selected.ref)
      ? result
      : null;
  const displayName = copy?.role.displayName ?? selected?.label ?? "本轮相逢";
  const roleComposite = qianzaiRoleComposite(model, roleCompositeImages);
  const layers = useRef<HTMLDivElement>(null),
    motion = useQianzaiMotion(active),
    [menuOpen, setMenuOpen] = useState(false),
    [musicNotice, setMusicNotice] = useState(false);
  const reference =
    referenceComposite?.mode === "reference-only" &&
    referenceComposite.before.sha256 ===
      "778e1ae1817fc53840d4478cbcd0e6074daba6e3febe7456801066a4a396db38" &&
    referenceComposite.full.sha256 ===
      "08ed543b80e55e4a5c3d02819270cf87c216bdc370e78465aba6c9b48ad9c425"
      ? referenceComposite
      : undefined;
  const frames = roleComposite ?? reference;
  useEffect(() => {
    if (presentation !== "playing" || !startedAt || !layers.current) return;
    const elapsed = Math.max(0, performance.now() - startedAt);
    for (const animation of layers.current.getAnimations({ subtree: true }))
      if (Number.isFinite(animation.effect?.getComputedTiming().endTime))
        animation.currentTime = Math.max(
          Number(animation.currentTime ?? 0),
          elapsed,
        );
  }, [
    frames?.before.objectUrl,
    frames?.full.objectUrl,
    presentation,
    startedAt,
  ]);
  return (
    <Scene
      name="result"
      className={scenes.reveal}
      composite={!!frames}
      fluid={!frames && !!portrait}
    >
      <div
        ref={layers}
        className={`${scenes.revealLayers} ${scenes.reveal} ${presentation === "playing" ? scenes.playing : presentation === "ready" ? scenes.ready : ""}`}
        data-reveal-phase={presentation}
        data-qianzai-reveal-mode={
          frames ? "composite" : portrait ? "layered" : "missing"
        }
        data-motion={motion ? "running" : "paused"}
        aria-hidden={presentation === "waiting"}
      >
        {frames ? (
          <>
            <ArtImage
              src={frames.before.objectUrl}
              className={scenes["reveal-art"]}
            />
            <ArtImage
              src={frames.full.objectUrl}
              className={`${scenes["reveal-art"]} ${scenes.full}`}
            />
          </>
        ) : portrait ? (
          <>
            <ArtImage
              src={portrait.objectUrl}
              asset={portrait.asset}
              alt={`${displayName}人物画作`}
              className={scenes.dynamicPortrait}
            />
            <div className={scenes.dynamicShade} aria-hidden="true" />
            <div
              className={scenes.dynamicIdentity}
              data-qianzai-reveal-copy={copy ? "bound" : "unavailable"}
            >
              <p className={scenes.dynamicKicker}>你是</p>
              <div className={scenes.dynamicNameRow}>
                {nameArt ? (
                  <ArtImage
                    src={nameArt.objectUrl}
                    alt={displayName}
                    className={scenes.dynamicNameArt}
                  />
                ) : (
                  <div className={scenes.dynamicNameMissing}>
                    <h2>{displayName}</h2>
                    <p>姓名字图尚未提供</p>
                  </div>
                )}
                {copy?.role.honorific && (
                  <span
                    className={scenes.dynamicSeal}
                    data-qianzai-honorific
                    style={
                      {
                        "--seal-characters": Array.from(copy.role.honorific)
                          .length,
                      } as CSSProperties
                    }
                  >
                    {copy.role.honorific}
                  </span>
                )}
                {copy && (
                  <blockquote
                    className={scenes.dynamicQuote}
                    data-qianzai-reveal-quote
                    cite={copy.quote.sourceUrl}
                    title={copy.quote.source}
                  >
                    {copy.quote.text}
                    <cite className={scenes.srOnly}>{copy.quote.source}</cite>
                  </blockquote>
                )}
              </div>
              {copy && (
                <div className={scenes.dynamicLines} data-qianzai-reveal-lines>
                  {copy.reveal.lines.map((line, i) => (
                    <p key={`${copy.reveal.id}:${i}`}>{line}</p>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className={scenes.resultIdentity}>
              <p>与你相逢的是</p>
              <h1>{displayName}</h1>
              <p>本轮人物画作尚未按完整揭晓版式提供，可继续阅读已封存报告。</p>
            </div>
          </>
        )}
        {!frames && (
          <header className={scenes.dynamicHeader}>
            <p>千载同心</p>
            <span>终章 · 命定相逢</span>
          </header>
        )}
        <h1 className={scenes.srOnly}>{displayName}</h1>
        <div className={scenes["reveal-moonbeam"]} aria-hidden="true" />
        <div className={scenes["ink-flash"]} aria-hidden="true" />
        <div className={scenes["reveal-glimmers"]} aria-hidden="true">
          {Array.from({ length: 16 }, (_, i) => (
            <span
              key={i}
              className={scenes["reveal-glimmer"]}
              style={
                {
                  "--x": `${(i * 59 + 13) % 96}%`,
                  "--y": `${8 + ((i * 47) % 88)}%`,
                  "--sz": `${2 + (i % 3)}px`,
                  "--dur": `${5 + (i % 6)}s`,
                  "--delay": `${-i * 1.23}s`,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <button
          className={`${scenes["reveal-hot"]} ${scenes.back}`}
          aria-label="阅读已封存的人物报告"
          onClick={() => onRead("report")}
        >
          {!frames && (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m15 4-8 8 8 8" />
            </svg>
          )}
        </button>
        <button
          className={`${scenes["reveal-hot"]} ${scenes.music}`}
          aria-label="音乐说明"
          onClick={() => setMusicNotice(!musicNotice)}
        >
          {!frames && (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M10 17V5l10-2v12M10 8l10-2" />
              <ellipse cx="6.5" cy="18" rx="3.5" ry="2.5" />
              <ellipse cx="16.5" cy="16" rx="3.5" ry="2.5" />
            </svg>
          )}
        </button>
        <button
          className={`${scenes["reveal-hot"]} ${scenes.more}`}
          aria-label="揭晓选项"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {!frames && (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          )}
        </button>
        {menuOpen && (
          <div className={`${scenes["reveal-menu"]} ${scenes.visible}`}>
            <TestingNote model={model} />
            {onReplay && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onReplay();
                }}
              >
                重新播放揭晓
              </button>
            )}
            <button onClick={() => onRead("report")}>阅读人物报告</button>
            <p className={scenes.artNote}>
              {frames
                ? "画面包含固定角色艺术文案；本轮分数与答题依据，以已封存的人物报告为准。"
                : "当前人物与姓名使用受控候选素材；本轮分数与答题依据，以已封存的人物报告为准。"}
            </p>
          </div>
        )}
        <button
          className={`${scenes["reveal-scroll-hit"]} ${!frames ? scenes.dynamicContinue : ""}`}
          data-reveal-continue
          disabled={!model.report || model.phase !== "completed"}
          aria-label="上滑查看人物报告"
          onClick={() => onRead("report")}
        >
          {!frames && (
            <>
              <svg viewBox="0 0 32 24" aria-hidden="true">
                <path d="m3 4 13 10L29 4M3 12l13 10 13-10" />
              </svg>
              <span>上滑查看人物报告</span>
            </>
          )}
        </button>
        {musicNotice && (
          <p
            className={`${scenes["reveal-toast"]} ${scenes.visible}`}
            role="status"
          >
            当前未提供音轨。
          </p>
        )}
      </div>
    </Scene>
  );
}
