"use client";

import { useState } from "react";
import type { ConsumerExperiencePropsV2 } from "./interfaces";
import type { ConsumerV2HostProps } from "@/lib/consumer-contract/v2/client-contract";
import type { ConsumerReadingPageV2, ConsumerViewPropsV2 } from "./interfaces";
import {
  ConsumerCoverViewV2,
  ConsumerPreferenceViewV2,
  ConsumerQuestionViewV2,
  ConsumerResumeViewV2,
  ConsumerCompletionReviewViewV2,
  ConsumerResultViewV2,
  ConsumerReportViewV2,
  ConsumerPosterViewV2,
  ConsumerStatusV2,
  canEditConsumerV2,
} from "./components";
import {
  matchesConsumerMappingV2,
  CONSUMER_RENDERER_V2,
} from "./component-map";
import styles from "./consumer.module.css";

export function supportsStructuredReaderV2(
  model: ConsumerV2HostProps["model"],
) {
  const compatible = (display: {
    presentationMode: string;
    exports: { posterPng: boolean; fullReportPng: boolean };
  }) =>
    display.presentationMode === "structured-only" &&
    !display.exports.posterPng &&
    !display.exports.fullReportPng;
  if (model.entry && !compatible(model.entry)) return false;
  if (model.report) {
    const view = model.report.view;
    if (
      !compatible(view.display) ||
      !("kind" in view.font) ||
      view.font.kind !== "system-structured" ||
      view.font.pngAvailable !== false ||
      view.renderer.id !== CONSUMER_RENDERER_V2.id ||
      view.renderer.version !== CONSUMER_RENDERER_V2.version ||
      !matchesConsumerMappingV2(view.mapping)
    )
      return false;
  }
  return true;
}
/** Pure props host. Its only local state is the reading panel; IO and original operation stay with the owner. */
export function ConsumerExperienceV2({
  model,
  onEvent,
  initialScreen,
}: ConsumerExperiencePropsV2) {
  const [page, setPage] = useState<ConsumerReadingPageV2>(
    initialScreen ?? "cover",
  );
  const compatible = supportsStructuredReaderV2(model);
  const editable = compatible && canEditConsumerV2(model);
  const read = (next: ConsumerReadingPageV2) => {
    if (model.report) {
      if (
        ["result", "report", "poster"].includes(next) &&
        model.phase === "completed"
      )
        setPage(next);
    } else if (editable) setPage(next);
  };
  const event: ConsumerV2HostProps["onEvent"] = (value) => {
    if (!compatible) return;
    if (
      [
        "choose-preference",
        "choose-answer",
        "navigate",
        "save",
        "complete",
      ].includes(value.type) &&
      !editable
    )
      return;
    onEvent(value);
  };
  const props: ConsumerViewPropsV2 = { model, onEvent: event, onRead: read };
  const activePage = model.report
    ? ["report", "poster"].includes(page)
      ? page
      : "result"
    : ["result", "report", "poster"].includes(page)
      ? "cover"
      : page;
  return (
    <div className={styles.host} data-consumer-v2-mode="structured-only">
      <header className={styles.banner}>
        <strong>可读结构版本 · 系统字体 · 不提供 PNG 导出</strong>
        {model.entry?.kind === "synthetic" && (
          <p>
            合成测试内容，仅用于验证结构和操作，不代表正式题目、人物美术或实际用户报告。
          </p>
        )}
      </header>
      <ConsumerStatusV2 model={model} />
      {!compatible ? (
        <section className={styles.panel} role="alert">
          <h1>此呈现版本暂不兼容</h1>
          <p>
            当前结构阅读器不接受其他呈现模式、导出能力或不同运行时映射，请由运营方核对固定版本。
          </p>
        </section>
      ) : (
        <>
          {model.pendingOperation && (
            <section className={styles.pending} aria-label="原操作核对">
              <h2>
                保留原{model.pendingOperation === "save" ? "保存" : "完成"}操作
              </h2>
              <p>本页不会自动重发、另建请求或替换人物偏好。</p>
              <button
                disabled={
                  !["unknown", "conflict", "unavailable"].includes(model.phase)
                }
                onClick={() => event({ type: "resolve" })}
              >
                核对原操作
              </button>
              {model.phase === "conflict" && (
                <button onClick={() => event({ type: "reload" })}>
                  采用已核对服务器记录
                </button>
              )}
            </section>
          )}
          {model.entry && model.draft && !model.report && (
            <div>
              <div hidden={activePage !== "cover"}>
                <ConsumerCoverViewV2 {...props} />
              </div>
              <div hidden={activePage !== "preference"}>
                <ConsumerPreferenceViewV2 {...props} />
              </div>
              <div hidden={activePage !== "question"}>
                <ConsumerQuestionViewV2 {...props} />
              </div>
              <div hidden={activePage !== "resume"}>
                <ConsumerResumeViewV2 {...props} />
              </div>
              <div hidden={activePage !== "review"}>
                <ConsumerCompletionReviewViewV2 {...props} />
              </div>
            </div>
          )}
          {model.report && model.phase !== "denied" && (
            <div inert={model.phase !== "completed"}>
              <div hidden={activePage !== "result"}>
                <ConsumerResultViewV2 {...props} />
              </div>
              <div hidden={activePage !== "report"}>
                <ConsumerReportViewV2 {...props} />
              </div>
              <div hidden={activePage !== "poster"}>
                <ConsumerPosterViewV2 {...props} />
              </div>
            </div>
          )}
          {!model.entry && !model.report && (
            <section className={styles.panel}>
              <h1>等待读取体验内容</h1>
              <p>尚未取得可展示的内容，未确认任何保存或完成结果。</p>
            </section>
          )}
        </>
      )}
      <footer className={styles.actions}>
        {model.phase === "unavailable" && !model.pendingOperation && (
          <button onClick={() => event({ type: "reload" })}>重新读取</button>
        )}
        <button
          disabled={
            model.phase === "loading" ||
            model.phase === "saving" ||
            model.phase === "completing"
          }
          onClick={() => onEvent({ type: "logout" })}
        >
          退出本次访问
        </button>
      </footer>
    </div>
  );
}
