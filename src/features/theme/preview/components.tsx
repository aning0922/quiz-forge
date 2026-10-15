import type { ReactNode } from "react";
import type {
  PreviewEntry,
  PreviewReveal,
} from "@/features/product/preview/contracts";
import type { Answers } from "@/features/studio/preview/flow";
import styles from "./preview.module.css";
import { PREVIEW_REGISTRY } from "./registry";

type Common = { entry: PreviewEntry; media: ReactNode };
function Intro({ heading, body }: { heading: string; body: string }) {
  return (
    <header className={styles.intro}>
      <p className={styles.eyebrow}>QUIZFORGE · 内部预览</p>
      <h1 tabIndex={-1} data-preview-heading>
        {heading}
      </h1>
      <p className={styles.prose}>{body}</p>
    </header>
  );
}
export function CoverView({
  entry,
  media,
  onStart,
}: { onStart: () => void } & Common) {
  const p = entry.layouts.cover.props;
  return (
    <section
      data-preview-state="cover"
      className={`${styles.paper} ${styles.cover}`}
      data-density={p.density}
    >
      <div className={styles.coverMedia}>{media}</div>
      <div className={styles.coverBody}>
        <Intro heading={entry.product.title} body={p.body} />
        <h2>{p.heading}</h2>
        <p className={styles.note}>
          {entry.questions.length} 题 ·{" "}
          {entry.visualPresentation.sections.length} 厅 · 临时体验
        </p>
        <ol className={styles.chapters}>
          {entry.visualPresentation.sections.map((s) => (
            <li key={s.id}>
              <span>{s.chapter}</span>
              <strong>{s.name}</strong>
            </li>
          ))}
        </ol>
        <button className={styles.primary} onClick={onStart}>
          开始预览
        </button>
        <p className={styles.note}>
          答案仅在当前页面保留，刷新后重置。
          {entry.kind === "synthetic"
            ? "当前为合成测试内容。"
            : "内容与素材仍须人工审核。"}
        </p>
      </div>
    </section>
  );
}
export function QuestionView({
  entry,
  media,
  index,
  answers,
  onChoose,
  onMove,
  onPause,
  onScore,
  busy,
}: {
  index: number;
  answers: Answers;
  onChoose: (q: string, o: string) => void;
  onMove: (index: number) => void;
  onPause: () => void;
  onScore: () => void;
  busy: boolean;
} & Common) {
  const q = entry.questions[index]!,
    frame = entry.visualPresentation.questionFrames.find(
      (f) =>
        f.questionRef.id === q.id &&
        f.questionRef.productId === q.productId &&
        f.questionRef.version === q.version,
    )!;
  const section = entry.visualPresentation.sections.find(
      (s) => s.id === frame.sectionId,
    )!,
    p = entry.layouts.question.props;
  const complete = entry.questions.every((q) => answers[q.id]);
  return (
    <section
      data-preview-state="question"
      className={`${styles.paper} ${styles.question}`}
      data-density={p.density}
    >
      <aside className={styles.questionScene}>
        {media}
        <div className={styles.sceneCaption}>
          <span>{section.chapter}</span>
          <h2>{section.name}</h2>
          <p>{section.introduction}</p>
        </div>
      </aside>
      <div className={styles.questionBody}>
        <p className={styles.eyebrow}>{p.heading}</p>
        {p.showProgress && (
          <>
            <p className={styles.note}>
              第 {index + 1} 题 / 共 {entry.questions.length} 题 · 已答{" "}
              {Object.keys(answers).length} 题
            </p>
            <progress
              aria-label="答题进度"
              value={Object.keys(answers).length}
              max={entry.questions.length}
            />
          </>
        )}
        <p className={styles.caption}>{frame.caption}</p>
        <h1 tabIndex={-1} data-preview-heading>
          {q.prompt}
        </h1>
        <p className={styles.note}>{p.body}</p>
        <fieldset className={styles.options}>
          <legend className={styles.srOnly}>选择本题答案</legend>
          {q.options.map((o, i) => (
            <label
              key={o.id}
              className={styles.option}
              data-selected={answers[q.id] === o.id}
            >
              <input
                type="radio"
                name={`question-${q.id}`}
                value={o.id}
                checked={answers[q.id] === o.id}
                onChange={() => onChoose(q.id, o.id)}
              />
              <span className={styles.optionIndex}>
                {String.fromCharCode(65 + i)}
              </span>
              <span>{o.label}</span>
            </label>
          ))}
        </fieldset>
        <div className={styles.actions}>
          <button
            className={styles.secondary}
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
          >
            上一题
          </button>
          {index < entry.questions.length - 1 ? (
            <button
              className={styles.primary}
              disabled={!answers[q.id]}
              onClick={() => onMove(index + 1)}
            >
              下一题
            </button>
          ) : (
            <button
              className={styles.primary}
              disabled={!complete || busy}
              onClick={onScore}
            >
              {busy ? "正在核验答案…" : "揭晓结果"}
            </button>
          )}
        </div>
        {!complete && index === entry.questions.length - 1 && (
          <p className={styles.note}>
            请完成全部题目后揭晓。可返回检查未答题。
          </p>
        )}
        <button className={styles.textButton} onClick={onPause}>
          暂歇，查看当前进度
        </button>
      </div>
    </section>
  );
}
export function ResumeView({
  entry,
  answers,
  onContinue,
  onQuestion,
}: {
  answers: Answers;
  onContinue: () => void;
  onQuestion: (index: number) => void;
} & Common) {
  const p = entry.layouts.resume.props;
  return (
    <section
      data-preview-state="resume"
      className={`${styles.paper} ${styles.reading}`}
      data-density={p.density}
    >
      <Intro heading={p.heading} body={p.body} />
      <div className={styles.resumeSeal}>暂歇</div>
      <h2>此页进度仍在</h2>
      <p>
        已答 {Object.keys(answers).length} / {entry.questions.length}{" "}
        题。答案仅保留在本页内存中，刷新后重置。
      </p>
      <ol className={styles.questionList}>
        {entry.questions.map((q, i) => (
          <li key={q.id}>
            <button className={styles.secondary} onClick={() => onQuestion(i)}>
              第 {i + 1} 题 · {answers[q.id] ? "已选择" : "未选择"}
            </button>
          </li>
        ))}
      </ol>
      <button className={styles.primary} onClick={onContinue}>
        继续答题
      </button>
    </section>
  );
}
type Revealed = Common & {
  reveal: PreviewReveal;
  onQuestion: () => void;
  onReport: () => void;
  onResult: () => void;
  onPoster: () => void;
};
export function ResultView({
  reveal,
  media,
  onQuestion,
  onReport,
  onPoster,
}: Revealed) {
  const p = reveal.result.layout.props;
  return (
    <section
      data-preview-state="result"
      className={styles.cabinet}
      data-density={p.density}
    >
      <div className={styles.resultStage}>
        {media}
        <div className={styles.stageRule} />
      </div>
      <div className={styles.resultBody}>
        <p className={styles.eyebrow}>{p.heading}</p>
        <h1 tabIndex={-1} data-preview-heading>
          {reveal.result.displayName}
        </h1>
        <p className={styles.subtitle}>{reveal.result.subtitle}</p>
        <p className={styles.prose}>{p.body}</p>
        <p className={styles.note}>确定性计算 · 临时预览 · 非正式报告</p>
        <div className={styles.actions}>
          <button className={styles.goldButton} onClick={onReport}>
            展开报告
          </button>
          <button className={styles.darkButton} onClick={onPoster}>
            查看海报
          </button>
        </div>
        <button className={styles.textButton} onClick={onQuestion}>
          返回检查答案
        </button>
      </div>
    </section>
  );
}
export function DimensionList({ reveal }: { reveal: PreviewReveal }) {
  return (
    <dl className={styles.dimensions}>
      {reveal.dimensions.map((d) => (
        <div key={`${d.dimensionRef.id}@${d.dimensionRef.version}`}>
          <dt>{d.label}</dt>
          <dd>
            <span>{d.normalizedText}</span>
            <div className={styles.dimensionTrack} aria-hidden="true">
              <i style={{ width: `${d.normalizedText}%` }} />
            </div>
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function ReportView({
  reveal,
  media,
  onResult,
  onPoster,
  onQuestion,
}: Revealed) {
  const p = reveal.report.layout.props,
    b = reveal.report.baseline;
  return (
    <article
      data-preview-state="report"
      className={`${styles.paper} ${styles.report}`}
      data-density={p.density}
    >
      <div className={styles.reportHero}>
        <div>{media}</div>
        <div>
          <p className={styles.eyebrow}>{p.heading}</p>
          <h1 tabIndex={-1} data-preview-heading>
            {b.title}
          </h1>
          <p className={styles.subtitle}>
            {reveal.result.displayName} · {reveal.result.subtitle}
          </p>
        </div>
      </div>
      <div className={styles.reportBody}>
        <p className={styles.note}>{p.body}</p>
        <section>
          <h2>报告摘要</h2>
          <p className={styles.prose}>{b.summary}</p>
        </section>
        <section>
          <h2>维度记录</h2>
          <DimensionList reveal={reveal} />
        </section>
        <section>
          <h2>优势</h2>
          <ul>
            {b.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
        <section>
          <h2>张力</h2>
          <ul>
            {b.tensions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
        <section className={styles.reflection}>
          <h2>留给自己的思考</h2>
          <p className={styles.prose}>{b.reflection}</p>
        </section>
        <p className={styles.note}>{b.disclaimer}</p>
        <p className={styles.note}>内部预览／待审／非正式报告</p>
        <div className={styles.actions}>
          <button className={styles.secondary} onClick={onResult}>
            返回揭晓
          </button>
          <button className={styles.primary} onClick={onPoster}>
            查看海报
          </button>
        </div>
        <button className={styles.textButton} onClick={onQuestion}>
          返回检查答案
        </button>
      </div>
    </article>
  );
}
export function PosterView({
  reveal,
  media,
  onReport,
  children,
}: Revealed & { children: ReactNode }) {
  const p = reveal.poster;
  return (
    <section
      data-preview-state="poster"
      className={`${styles.paper} ${styles.reading}`}
    >
      <Intro
        heading={p.kind === "ready" ? p.layout.props.heading : "海报暂不可导出"}
        body={
          p.kind === "ready"
            ? p.layout.props.body
            : "此结果超过海报的完整排版容量，报告仍可阅读。"
        }
      />
      {p.kind === "ready" && (
        <div className={styles.posterSheet}>
          <div className={styles.posterArt}>{media}</div>
          <div className={styles.posterText}>
            <h2>{p.displayName}</h2>
            <p>{p.subtitle}</p>
            <p className={styles.prose}>{p.posterLine.text}</p>
            <DimensionList reveal={reveal} />
            <p className={styles.note}>{p.posterDisclosure}</p>
            <p className={styles.note}>内部预览／待审／非正式报告</p>
          </div>
        </div>
      )}
      {children}
      <button className={styles.secondary} onClick={onReport}>
        返回报告
      </button>
    </section>
  );
}
/** Compiled, explicit state mapping. No source code, CSS, module path, or arbitrary props from a package. */
export const PREVIEW_COMPONENTS = Object.freeze({
  "folio-cover": CoverView,
  "folio-question": QuestionView,
  "folio-resume": ResumeView,
  "cabinet-result": ResultView,
  "folio-report": ReportView,
  "folio-poster": PosterView,
});
export const PREVIEW_VIEW_REGISTRY = Object.freeze({
  ...PREVIEW_REGISTRY,
  components: PREVIEW_COMPONENTS,
});
