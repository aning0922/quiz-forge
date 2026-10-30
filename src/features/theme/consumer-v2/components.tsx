"use client";

import { useId } from "react";
import type { ConsumerV2ReaderModel } from "@/lib/consumer-contract/v2/client-contract";
import type { ComposedReportBodyV1 } from "@/lib/assessment-contract/composed-report-v1";
import type { ConsumerViewPropsV2 } from "./interfaces";
import styles from "./consumer.module.css";

const preferenceLabels = {
  male: "男性人物",
  female: "女性人物",
  any: "不限人物",
};
const phaseLabels: Record<ConsumerV2ReaderModel["phase"], string> = {
  loading: "正在读取授权与进度。",
  ready: "可继续编辑。",
  saving: "正在核对本次保存，请保留此页。",
  completing: "正在核对本次完成，请保留此页。",
  unknown: "原操作结果尚未确定，输入已保留，请核对原操作。",
  conflict: "服务器进度与本页不一致，输入已保留，请核对后再继续。",
  completed: "本次报告已封存，以下为只读内容。",
  denied: "当前访问权限已失效，操作已停用。",
  unavailable: "暂时无法读取，原操作与输入不会因此自动重发。",
};
export function canEditConsumerV2(model: ConsumerV2ReaderModel) {
  return model.phase === "ready" && model.pendingOperation === null;
}
function sameAnswers(model: ConsumerV2ReaderModel) {
  const a = model.draft?.answers,
    b = model.state?.answers;
  return (
    !!a &&
    !!b &&
    a.length === b.length &&
    a.every((v) =>
      b.some((s) => s.questionId === v.questionId && s.optionId === v.optionId),
    )
  );
}
export function consumerDraftStatusV2(model: ConsumerV2ReaderModel) {
  const d = model.draft,
    s = model.state;
  return {
    preferenceSaved:
      !!d?.matchingContext &&
      !!s?.lastSave &&
      JSON.stringify(d.matchingContext) === JSON.stringify(s.matchingContext),
    answersSaved: !!s?.lastSave && sameAnswers(model),
    progressSaved:
      !!s?.lastSave && d?.progress.questionId === s.progress.questionId,
  };
}
function answeredCount(model: ConsumerV2ReaderModel) {
  return (
    model.entry?.questions.filter((q) =>
      model.draft?.answers.some(
        (a) =>
          a.questionId === q.ref.id &&
          q.options.some((o) => o.ref.id === a.optionId),
      ),
    ).length ?? 0
  );
}
export function ConsumerStatusV2({
  model,
}: Pick<ConsumerViewPropsV2, "model">) {
  const saved = consumerDraftStatusV2(model);
  return (
    <aside className={styles.status} aria-label="当前进度状态">
      <p role="status">{phaseLabels[model.phase]}</p>
      {model.message && <p role="alert">{model.message}</p>}
      {model.draft && !model.report && (
        <>
          <p>
            {model.draft.matchingContext
              ? `目标人物偏好：${preferenceLabels[model.draft.matchingContext.preference]} · ${saved.preferenceSaved ? "已保存" : "尚未保存"}`
              : "尚未选择目标人物偏好；未选择与主动不限不同。"}
          </p>
          <p>
            答案：已选 {answeredCount(model)} /{" "}
            {model.entry?.questions.length ?? 0} 题 ·{" "}
            {saved.answersSaved ? "当前答案已保存" : "当前答案尚未保存"}
          </p>
          {!saved.progressSaved && <p>当前阅读位置尚未保存。</p>}
          {saved.preferenceSaved &&
            saved.answersSaved &&
            saved.progressSaved &&
            model.savedAt && (
              <p>
                最近保存：<time dateTime={model.savedAt}>{model.savedAt}</time>
              </p>
            )}
        </>
      )}
    </aside>
  );
}
export function ConsumerCoverViewV2({ model, onRead }: ConsumerViewPropsV2) {
  return (
    <section className={styles.panel} data-consumer-v2-state="cover">
      <h1>{model.entry?.product.title ?? "测评结构预览"}</h1>
      <p>
        通过 {model.entry?.questions.length ?? 0}{" "}
        道情境题，阅读本轮选择组成的六卷报告。
      </p>
      <p>这是可读结构版本。人物画面与正式美术尚未接入。</p>
      <button
        disabled={!canEditConsumerV2(model) || !model.entry || !model.draft}
        onClick={() => onRead("preference")}
      >
        选择目标人物并开始
      </button>
    </section>
  );
}
export function ConsumerPreferenceViewV2({
  model,
  onEvent,
  onRead,
}: ConsumerViewPropsV2) {
  const group = useId(),
    enabled = canEditConsumerV2(model),
    preference = model.draft?.matchingContext?.preference;
  return (
    <section className={styles.panel} data-consumer-v2-state="preference">
      <h1>希望与哪类人物相逢</h1>
      <p>
        这是目标人物偏好，不是对你的性别作判断。它只筛选候选人物，不改变五维分数。
      </p>
      <fieldset disabled={!enabled || !model.draft}>
        <legend>选择目标人物范围</legend>
        {(model.entry?.preferences ?? []).map((value) => (
          <label className={styles.option} key={value}>
            <input
              type="radio"
              name={group}
              value={value}
              checked={preference === value}
              onChange={() => {
                if (enabled)
                  onEvent({ type: "choose-preference", preference: value });
              }}
            />
            <span>{preferenceLabels[value]}</span>
          </label>
        ))}
      </fieldset>
      <div className={styles.actions}>
        <button
          disabled={!enabled || !preference}
          onClick={() => onEvent({ type: "save" })}
        >
          保存偏好与当前进度
        </button>
        <button
          disabled={!enabled || !preference || !model.entry?.questions.length}
          onClick={() => {
            const questionId =
              model.draft?.progress.questionId ??
              model.entry?.questions[0]?.ref.id;
            if (!questionId) return;
            onEvent({ type: "navigate", questionId });
            onRead("question");
          }}
        >
          进入答题
        </button>
      </div>
    </section>
  );
}
export function ConsumerQuestionViewV2({
  model,
  onEvent,
  onRead,
}: ConsumerViewPropsV2) {
  const group = useId(),
    enabled = canEditConsumerV2(model) && !!model.draft?.matchingContext;
  const questions = model.entry?.questions ?? [];
  const index = questions.findIndex(
    (q) => q.ref.id === model.draft?.progress.questionId,
  );
  const question = questions[index];
  return (
    <section className={styles.panel} data-consumer-v2-state="question">
      {question ? (
        <>
          <p>
            第 {question.act} 幕 · 第 {index + 1} / {questions.length} 题
          </p>
          <h1>{question.prompt}</h1>
          <fieldset disabled={!enabled}>
            <legend>请选择符合本轮想法的一项</legend>
            {question.options.map((option) => (
              <label className={styles.option} key={option.ref.id}>
                <input
                  type="radio"
                  name={group}
                  value={option.ref.id}
                  checked={
                    model.draft?.answers.some(
                      (a) =>
                        a.questionId === question.ref.id &&
                        a.optionId === option.ref.id,
                    ) ?? false
                  }
                  onChange={() => {
                    if (enabled)
                      onEvent({
                        type: "choose-answer",
                        questionId: question.ref.id,
                        optionId: option.ref.id,
                      });
                  }}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>
          <div className={styles.actions}>
            <button
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
            <button
              disabled={!enabled || index >= questions.length - 1}
              onClick={() =>
                onEvent({
                  type: "navigate",
                  questionId: questions[index + 1]!.ref.id,
                })
              }
            >
              下一题
            </button>
            <button
              disabled={!enabled}
              onClick={() => onEvent({ type: "save" })}
            >
              保存当前进度
            </button>
          </div>
        </>
      ) : (
        <>
          <h1>请选择一道题</h1>
          <p>当前没有可展示的题目位置，请从进度列表选择。</p>
        </>
      )}
      <div className={styles.actions}>
        <button disabled={!enabled} onClick={() => onRead("resume")}>
          检查全部进度
        </button>
        <button
          disabled={
            !enabled ||
            answeredCount(model) !== questions.length ||
            !questions.length
          }
          onClick={() => onRead("review")}
        >
          检查完成条件
        </button>
      </div>
    </section>
  );
}
export function ConsumerResumeViewV2({
  model,
  onEvent,
  onRead,
}: ConsumerViewPropsV2) {
  const enabled = canEditConsumerV2(model);
  return (
    <section className={styles.panel} data-consumer-v2-state="resume">
      <h1>本轮答题进度</h1>
      <p>
        已选择 {answeredCount(model)} / {model.entry?.questions.length ?? 0}{" "}
        题。未保存的答案与偏好请先保存。
      </p>
      <ol className={styles.questionList}>
        {model.entry?.questions.map((q, index) => {
          const selected = q.options.find((o) =>
            model.draft?.answers.some(
              (a) => a.questionId === q.ref.id && a.optionId === o.ref.id,
            ),
          );
          return (
            <li key={q.ref.id}>
              <button
                disabled={!enabled || !model.draft?.matchingContext}
                onClick={() => {
                  onEvent({ type: "navigate", questionId: q.ref.id });
                  onRead("question");
                }}
              >
                <span>
                  第 {index + 1} 题 · {q.prompt}
                </span>
                <span>
                  {selected ? `已选择：${selected.label}` : "尚未选择"}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className={styles.actions}>
        <button disabled={!enabled} onClick={() => onRead("preference")}>
          检查人物偏好
        </button>
        <button
          disabled={!enabled || !model.draft?.matchingContext}
          onClick={() => onEvent({ type: "save" })}
        >
          保存偏好与答案
        </button>
        <button
          disabled={
            !enabled ||
            !model.entry ||
            answeredCount(model) !== model.entry.questions.length ||
            !model.draft?.matchingContext
          }
          onClick={() => onRead("review")}
        >
          进入完成确认
        </button>
      </div>
    </section>
  );
}
export function ConsumerCompletionReviewViewV2({
  model,
  onEvent,
  onRead,
}: ConsumerViewPropsV2) {
  const complete =
    !!model.entry?.questions.length &&
    answeredCount(model) === model.entry.questions.length &&
    !!model.draft?.matchingContext;
  const saved = consumerDraftStatusV2(model);
  const allSaved =
    saved.preferenceSaved && saved.answersSaved && saved.progressSaved;
  return (
    <section className={styles.panel} data-consumer-v2-state="review">
      <h1>确认完成本轮测评</h1>
      <p>
        已选择 {answeredCount(model)} / {model.entry?.questions.length ?? 0}{" "}
        题。服务器确认完成后将封存本轮六卷全文，原链接只读查看同一份报告。
      </p>
      <p>
        尚未保存的偏好、答案和阅读位置会在上方分别提示。完成结果以服务器回执为准。
      </p>
      {complete && !allSaved && (
        <p role="status">请先返回检查并保存当前偏好与答案，再确认完成。</p>
      )}
      <div className={styles.actions}>
        <button
          disabled={!canEditConsumerV2(model) || !complete || !allSaved}
          onClick={() => onEvent({ type: "complete" })}
        >
          确认完成并封存报告
        </button>
        <button
          disabled={!canEditConsumerV2(model)}
          onClick={() => onRead("resume")}
        >
          返回检查
        </button>
      </div>
    </section>
  );
}
function Matching({ body }: { body: ComposedReportBodyV1 }) {
  const { selected, runnerUp, status } = body.matching;
  return (
    <>
      <h2>{selected.label}</h2>
      <p>
        娱乐性契合指数：{selected.narrativeIndex} /
        100，不表示准确率或身份概率。
      </p>
      <p>
        {selected.kind === "literary-legendary"
          ? "文学／传说人物的艺术类比。"
          : "历史人物的文学类比，不是历史人物心理测量。"}
      </p>
      <p>
        {status === "single-candidate"
          ? "本轮候选池仅一人，没有第二候选。"
          : status === "near-tie"
            ? "前两位接近，当前排序不表示唯一确定的归属。"
            : "按本轮已封存匹配结果展示。"}
      </p>
      {status !== "single-candidate" && runnerUp && (
        <p>
          第二候选：{runnerUp.label} · 契合指数 {runnerUp.narrativeIndex} / 100
        </p>
      )}
    </>
  );
}
export function ConsumerResultViewV2({ model, onRead }: ConsumerViewPropsV2) {
  const body = model.report?.view.display.body;
  return (
    <section className={styles.panel} data-consumer-v2-state="result">
      <h1>{body?.title ?? "只读报告"}</h1>
      {body && (
        <>
          <Matching body={body} />
          <p>{body.notice}</p>
        </>
      )}
      <p>人物图像尚未接入，本页不使用其他人物整图代替。</p>
      <div className={styles.actions}>
        <button disabled={!body} onClick={() => onRead("report")}>
          阅读完整六卷
        </button>
        <button disabled={!body} onClick={() => onRead("poster")}>
          查看保存分享能力
        </button>
      </div>
    </section>
  );
}
function Evidence({
  entries,
  label,
}: {
  entries: ComposedReportBodyV1["volumes"][number]["paragraphs"][number]["evidence"];
  label: string;
}) {
  return entries.length ? (
    <div>
      <h4>{label}</h4>
      <ul>
        {entries.map((e, index) => (
          <li key={`${e.questionRef.id}:${e.optionRef.id}:${index}`}>
            <p>{e.prompt}</p>
            <p>本轮选择：{e.optionText}</p>
            <p>适用范围：{e.scope}</p>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
}
/** Plain display content shared with Studio; it carries no consumer session or completion authority. */
export function StructuredReportContentV2({
  body,
}: {
  body: ComposedReportBodyV1;
}) {
  const id = useId();
  return (
    <>
      <p>{body.notice}</p>
      <nav className={styles.actions} aria-label="六卷目录">
        {body.volumes.map((v) => (
          <a key={v.id} href={`#${id}-${v.id}`}>
            {v.title}
          </a>
        ))}
      </nav>
      <Matching body={body} />
      <h2>{body.dimensions.length === 5 ? "本轮五维" : "本轮维度"}</h2>
      <dl className={styles.dimensions}>
        {body.dimensions.map((d) => (
          <div key={d.dimensionRef.id}>
            <dt>{d.label}</dt>
            <dd>{d.score} / 100</dd>
          </div>
        ))}
      </dl>
      {body.volumes.map((v) => (
        <article key={v.id} id={`${id}-${v.id}`} className={styles.volume}>
          <h2>{v.title}</h2>
          {v.paragraphs.map((paragraph, index) => (
            <section key={index} className={styles.paragraph}>
              <p className={styles.qualifier}>
                {paragraph.status === "facts-only"
                  ? "仅记录本轮事实"
                  : paragraph.status === "fallback"
                    ? "证据不足时的说明"
                    : "有证据支持的限定描述"}{" "}
                · {paragraph.kind === "literary" ? "文学类比" : "本轮情境"}
              </p>
              <p>{paragraph.text}</p>
              <Evidence
                entries={paragraph.evidence}
                label="支持本段的实际选择"
              />
              <Evidence
                entries={paragraph.counterevidence}
                label="应同时阅读的反向证据"
              />
            </section>
          ))}
        </article>
      ))}
      <details>
        <summary>查看本轮全部答案记录（{body.answers.length} 题）</summary>
        <ol>
          {body.answers.map((a) => (
            <li key={a.questionRef.id}>
              <p>
                第 {a.act} 幕 · {a.prompt}
              </p>
              <p>{a.optionText}</p>
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}
export function ConsumerReportViewV2({ model, onRead }: ConsumerViewPropsV2) {
  const body = model.report?.view.display.body;
  return (
    <section className={styles.panel} data-consumer-v2-state="report">
      <h1>完整六卷 · {body?.title ?? "只读报告"}</h1>
      {body && <StructuredReportContentV2 body={body} />}
      <div className={styles.actions}>
        <button onClick={() => onRead("result")}>返回相逢结果</button>
        <button onClick={() => onRead("poster")}>查看保存分享能力</button>
      </div>
    </section>
  );
}
export function ConsumerPosterViewV2({ onRead }: ConsumerViewPropsV2) {
  return (
    <section className={styles.panel} data-consumer-v2-state="poster">
      <h1>保存与分享</h1>
      <p>本阶段仅支持页面内阅读。海报 PNG、完整长图 PNG 与分享暂不可用。</p>
      <p>系统字体用于结构阅读，尚未提供固定字形及导出字体保证。</p>
      <button onClick={() => onRead("report")}>返回完整六卷</button>
    </section>
  );
}
export const CONSUMER_COMPONENTS_V2 = Object.freeze({
  "consumer-structured-cover": ConsumerCoverViewV2,
  "consumer-structured-question": ConsumerQuestionViewV2,
  "consumer-structured-resume": ConsumerResumeViewV2,
  "consumer-structured-result": ConsumerResultViewV2,
  "consumer-structured-report": ConsumerReportViewV2,
  "consumer-structured-poster": ConsumerPosterViewV2,
});
