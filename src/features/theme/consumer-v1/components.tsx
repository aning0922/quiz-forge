import type { ReactNode } from "react";
import type {
  DisplayAnswers,
  DisplayEntryBodyV1,
  ResultDisplaySnapshotV1,
} from "@/lib/assessment-contract/display-v1";
import type {
  ConsumerControls,
  ConsumerCoverProps,
  ConsumerQuestionProps,
  ConsumerResumeProps,
  ConsumerResultProps,
  ConsumerReportProps,
  ConsumerPosterProps,
  ConsumerMediaPresentation,
} from "./interfaces";
import styles from "./consumer.module.css";

const blockedText = {
  saving: "正在保存。请等待服务器确认，暂不能继续修改。",
  unknown: "保存结果尚未确认。请在原请求核实区核实后继续。",
  conflict: "服务器进度已变化。请先检查并明确采用服务器当前进度。",
  "authority-lost":
    "访问授权已失效。请使用原访问链接重新进入；待核实请求仍保留。",
  unavailable: "当前内容暂不可用。请保留原请求，稍后重新读取。",
} as const;

function Intro({ heading, body }: { heading: string; body: string }) {
  return (
    <header className={styles.intro}>
      <p className={styles.eyebrow}>QUIZFORGE · 内测体验</p>
      <h1 tabIndex={-1} data-consumer-heading>
        {heading}
      </h1>
      <p className={styles.prose}>{body}</p>
    </header>
  );
}
function SaveStatus<A>({ controls }: { controls: ConsumerControls<A> }) {
  const savedAt =
    controls.kind === "enabled" && controls.save.kind === "saved"
      ? controls.save.savedAt
      : null;
  const moment = savedAt ? new Date(savedAt) : null;
  const readable =
    moment && Number.isFinite(moment.getTime())
      ? new Intl.DateTimeFormat("zh-CN", {
          timeZone: "Asia/Shanghai",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(moment)
      : null;
  return (
    <div
      className={styles.saveStatus}
      role="status"
      aria-live="polite"
      data-consumer-save={
        controls.kind === "blocked" ? controls.reason : controls.save.kind
      }
    >
      {controls.kind === "blocked" ? (
        blockedText[controls.reason]
      ) : controls.save.kind === "unsaved" ? (
        "尚未保存。本页修改仍需服务器确认，请留意保存状态。"
      ) : (
        <>
          <p>当前进度已保存</p>
          {readable && (
            <p>
              保存时间（北京时间）：<time dateTime={savedAt!}>{readable}</time>
            </p>
          )}
          <p>重新打开原访问链接可读取服务器进度；其他设备可能更新它。</p>
        </>
      )}
    </div>
  );
}
function Media({ media }: { media: ConsumerMediaPresentation }) {
  return (
    <div className={styles.media} data-consumer-media={media.kind}>
      {media.kind === "ready" ? (
        media.content
      ) : (
        <div
          className={styles.mediaStatus}
          role={media.kind === "loading" ? "status" : "alert"}
        >
          <p>
            {media.kind === "loading"
              ? "正在核验并读取素材…"
              : "此素材暂不可用，文字内容仍可阅读。"}
          </p>
          {media.kind === "unavailable" && media.onRetry && (
            <button className={styles.secondary} onClick={media.onRetry}>
              重试素材读取
            </button>
          )}
        </div>
      )}
    </div>
  );
}
const selected = (
  answers: DisplayAnswers,
  q: DisplayEntryBodyV1["questions"][number],
) =>
  Object.hasOwn(answers, q.id) && q.options.some((o) => o.id === answers[q.id]);
const count = (entry: DisplayEntryBodyV1, answers: DisplayAnswers) =>
  entry.questions.filter((q) => selected(answers, q)).length;

export function ConsumerCoverView({
  entry,
  media,
  answers,
  controls,
}: ConsumerCoverProps) {
  const p = entry.layouts.cover.props,
    actions = controls.kind === "enabled" ? controls.actions : undefined;
  return (
    <section
      data-consumer-state="cover"
      className={`${styles.paper} ${styles.cover}`}
      data-density={p.density}
    >
      <div className={styles.coverMedia}>
        <Media media={media} />
      </div>
      <div className={styles.coverBody}>
        <Intro heading={entry.product.title} body={p.body} />
        <h2>{p.heading}</h2>
        <p className={styles.note}>
          {entry.questions.length} 题 ·{" "}
          {entry.visualPresentation.sections.length} 厅 · 内测体验
        </p>
        <ol className={styles.chapters}>
          {entry.visualPresentation.sections.map((s) => (
            <li key={s.id}>
              <span>{s.chapter}</span>
              <strong>{s.name}</strong>
            </li>
          ))}
        </ol>
        <SaveStatus controls={controls} />
        <button
          className={styles.primary}
          disabled={!actions}
          onClick={actions?.onStart}
        >
          {count(entry, answers) ? "继续答题" : "开始答题"}
        </button>
        <p className={styles.note}>
          本体验仅供内测，不代表对外发布。
          {entry.kind === "synthetic" && "当前为合成测试内容。"}
        </p>
      </div>
    </section>
  );
}

export function ConsumerQuestionView({
  entry,
  media,
  questionId,
  answers,
  controls,
}: ConsumerQuestionProps) {
  const index = entry.questions.findIndex((q) => q.id === questionId),
    q = entry.questions[index];
  const frame =
    q &&
    entry.visualPresentation.questionFrames.find(
      (f) =>
        f.questionRef.id === q.id &&
        f.questionRef.productId === q.productId &&
        f.questionRef.version === q.version,
    );
  const section =
    frame &&
    entry.visualPresentation.sections.find((s) => s.id === frame.sectionId);
  if (!q || !frame || !section)
    return (
      <section className={`${styles.paper} ${styles.reading}`} role="alert">
        <h1 data-consumer-heading tabIndex={-1}>
          题目暂不可用
        </h1>
        <p>固定题目与展示信息不匹配，请重新读取内容。</p>
      </section>
    );
  const p = entry.layouts.question.props,
    actions = controls.kind === "enabled" ? controls.actions : undefined,
    answered = count(entry, answers),
    complete = answered === entry.questions.length;
  return (
    <section
      data-consumer-state="question"
      className={`${styles.paper} ${styles.question}`}
      data-density={p.density}
    >
      <aside className={styles.questionScene}>
        <Media media={media} />
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
              第 {index + 1} 题 / 共 {entry.questions.length} 题 · 已选{" "}
              {answered} 题
            </p>
            <progress
              aria-label="答题进度"
              value={answered}
              max={entry.questions.length}
            />
          </>
        )}
        <p className={styles.caption}>{frame.caption}</p>
        <h1 tabIndex={-1} data-consumer-heading>
          {q.prompt}
        </h1>
        <p className={styles.note}>{p.body}</p>
        <fieldset className={styles.options} disabled={!actions}>
          <legend className={styles.srOnly}>选择本题答案</legend>
          {q.options.map((o, i) => (
            <label
              key={o.id}
              className={styles.option}
              data-selected={
                Object.hasOwn(answers, q.id) && answers[q.id] === o.id
              }
            >
              <input
                type="radio"
                name={`consumer-question-${q.id}`}
                value={o.id}
                checked={Object.hasOwn(answers, q.id) && answers[q.id] === o.id}
                onChange={() => actions?.onChoose(q.id, o.id)}
              />
              <span className={styles.optionIndex}>
                {String.fromCharCode(65 + i)}
              </span>
              <span>{o.label}</span>
            </label>
          ))}
        </fieldset>
        <SaveStatus controls={controls} />
        <div className={styles.actions}>
          <button
            className={styles.secondary}
            disabled={!actions || index === 0}
            onClick={() => {
              const prev = entry.questions[index - 1];
              if (prev) actions?.onMove(prev.id);
            }}
          >
            上一题
          </button>
          {index < entry.questions.length - 1 ? (
            <button
              className={styles.primary}
              disabled={!actions || !selected(answers, q)}
              onClick={() => {
                const next = entry.questions[index + 1];
                if (next) actions?.onMove(next.id);
              }}
            >
              下一题
            </button>
          ) : (
            <button
              className={styles.primary}
              disabled={!actions || !complete}
              onClick={actions?.onReviewCompletion}
            >
              检查并完成
            </button>
          )}
        </div>
        {!complete && index === entry.questions.length - 1 && (
          <p className={styles.note}>
            请先选择全部题目，再检查答案并确认完成。
          </p>
        )}
        <button
          className={styles.textButton}
          disabled={!actions}
          onClick={actions?.onOverview}
        >
          暂歇，查看进度
        </button>
      </div>
    </section>
  );
}

export function ConsumerResumeView({
  entry,
  answers,
  controls,
}: ConsumerResumeProps) {
  const p = entry.layouts.resume.props,
    actions = controls.kind === "enabled" ? controls.actions : undefined,
    answered = count(entry, answers);
  return (
    <section
      data-consumer-state="resume"
      className={`${styles.paper} ${styles.reading}`}
      data-density={p.density}
    >
      <Intro heading={p.heading} body={p.body} />
      <div className={styles.resumeSeal}>暂歇</div>
      <h2>回看这段行程</h2>
      <p>
        已选 {answered} / {entry.questions.length} 题。
      </p>
      <SaveStatus controls={controls} />
      <ol className={styles.questionList}>
        {entry.questions.map((q, i) => (
          <li key={q.id}>
            <button
              className={styles.secondary}
              disabled={!actions}
              onClick={() => actions?.onQuestion(q.id)}
            >
              <span className={styles.keepPhrase}>第 {i + 1} 题</span>
              {" · "}
              <span className={styles.keepPhrase}>
                {selected(answers, q) ? "已选择" : "未选择"}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className={`${styles.actions} ${styles.resumeActions}`}>
        <button
          className={styles.primary}
          disabled={!actions}
          onClick={actions?.onContinue}
        >
          继续答题
        </button>
        <button
          className={styles.secondary}
          disabled={!actions}
          onClick={actions?.onCover}
        >
          返回封面
        </button>
        <button
          className={styles.secondary}
          disabled={!actions || answered !== entry.questions.length}
          onClick={actions?.onReviewCompletion}
        >
          检查并完成
        </button>
      </div>
    </section>
  );
}

function CompletedNote() {
  return (
    <p className={styles.note}>
      已完成 · 报告已保存 · 仅供内测
      <br />
      此报告只读，重新进入仍查看同一份报告。
    </p>
  );
}
export function ConsumerResultView({
  display,
  media,
  onReport,
  onPoster,
}: ConsumerResultProps) {
  const p = display.result.layout.props;
  return (
    <section
      data-consumer-state="result"
      className={styles.cabinet}
      data-density={p.density}
    >
      <div className={styles.resultStage}>
        <Media media={media} />
        <div className={styles.stageRule} />
      </div>
      <div className={styles.resultBody}>
        <p className={styles.eyebrow}>{p.heading}</p>
        <h1 tabIndex={-1} data-consumer-heading>
          {display.result.displayName}
        </h1>
        <p className={styles.subtitle}>{display.result.subtitle}</p>
        <p className={styles.prose}>{p.body}</p>
        <CompletedNote />
        <div className={styles.actions}>
          <button className={styles.goldButton} onClick={onReport}>
            展开报告
          </button>
          <button className={styles.darkButton} onClick={onPoster}>
            查看海报
          </button>
        </div>
      </div>
    </section>
  );
}
function Dimensions({ display }: { display: ResultDisplaySnapshotV1 }) {
  return (
    <dl className={styles.dimensions}>
      {display.dimensions.map((d) => (
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
export function ConsumerReportView({
  display,
  media,
  onResult,
  onPoster,
}: ConsumerReportProps) {
  const p = display.report.layout.props,
    b = display.report.baseline,
    subtitle = `${display.result.displayName} · ${display.result.subtitle}`;
  return (
    <article
      data-consumer-state="report"
      className={`${styles.paper} ${styles.report}`}
      data-density={p.density}
    >
      <div className={styles.reportHero}>
        <Media media={media} />
        <div>
          <p className={styles.eyebrow}>{p.heading}</p>
          <h1 tabIndex={-1} data-consumer-heading>
            {b.title}
          </h1>
          {b.title !== subtitle && (
            <p className={styles.subtitle}>{subtitle}</p>
          )}
        </div>
      </div>
      <div className={styles.reportBody}>
        <p className={styles.note}>{p.body}</p>
        <CompletedNote />
        <section>
          <h2>报告摘要</h2>
          <p className={styles.prose}>{b.summary}</p>
        </section>
        <section>
          <h2>维度记录</h2>
          <Dimensions display={display} />
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
        <div className={styles.actions}>
          <button className={styles.secondary} onClick={onResult}>
            返回揭晓
          </button>
          <button className={styles.primary} onClick={onPoster}>
            查看海报
          </button>
        </div>
      </div>
    </article>
  );
}
export function ConsumerPosterView({
  display,
  media,
  exportState,
  onReport,
}: ConsumerPosterProps) {
  const p = display.poster;
  let control: ReactNode;
  if (p.kind === "ready")
    switch (exportState.kind) {
      case "idle":
        control = (
          <button className={styles.primary} onClick={exportState.onExport}>
            生成报告海报
          </button>
        );
        break;
      case "exporting":
        control = <p role="status">正在核验固定字体与素材并生成 PNG…</p>;
        break;
      case "ready":
        control = (
          <button className={styles.primary} onClick={exportState.onDownload}>
            下载 PNG 海报
          </button>
        );
        break;
      case "unavailable":
        control = (
          <div role="alert" className={styles.saveStatus}>
            <p>
              {exportState.reason === "authority-lost"
                ? "访问授权已失效，请使用原链接重新进入。"
                : "海报暂不可生成，已保存的报告仍可阅读。"}
            </p>
            {exportState.reason !== "authority-lost" && exportState.onRetry && (
              <button
                className={styles.secondary}
                onClick={exportState.onRetry}
              >
                重新生成海报
              </button>
            )}
          </div>
        );
        break;
    }
  return (
    <section
      data-consumer-state="poster"
      className={`${styles.paper} ${styles.reading}`}
    >
      <Intro
        heading={p.kind === "ready" ? p.layout.props.heading : "海报暂不可导出"}
        body={
          p.kind === "ready"
            ? p.layout.props.body
            : "此结果超过海报的完整排版容量，已保存的报告仍可阅读。"
        }
      />
      <CompletedNote />
      {p.kind === "ready" && (
        <div className={styles.posterSheet}>
          <div className={styles.posterArt}>
            <Media media={media} />
          </div>
          <div className={styles.posterText}>
            <h2>{p.displayName}</h2>
            <p>{p.subtitle}</p>
            <p className={styles.prose}>{p.posterLine.text}</p>
            <Dimensions display={display} />
            <p className={styles.note}>{p.posterDisclosure}</p>
            <p className={styles.note}>内测报告／已完成</p>
          </div>
        </div>
      )}
      <div className={styles.exportActions}>
        {control}
        <button className={styles.secondary} onClick={onReport}>
          返回报告
        </button>
      </div>
    </section>
  );
}

export const CONSUMER_COMPONENTS_V1 = Object.freeze({
  "consumer-folio-cover": ConsumerCoverView,
  "consumer-folio-question": ConsumerQuestionView,
  "consumer-folio-resume": ConsumerResumeView,
  "consumer-cabinet-result": ConsumerResultView,
  "consumer-folio-report": ConsumerReportView,
  "consumer-folio-poster": ConsumerPosterView,
});
