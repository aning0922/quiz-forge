"use client";

import { useMemo } from "react";
import { quizPackContentSchema } from "@/features/quizpack/v1/content";
import { quizPackContentV2Schema } from "@/features/quizpack/content/v2";
import styles from "./content-inspector.module.css";

/** Readable inspection of an already hash-checked fixed revision. No editing or execution. */
export function FixedContentInspector({
  productId,
  canonicalContentText,
}: {
  productId: string;
  canonicalContentText: string;
}) {
  const content = useMemo(() => {
    try {
      const raw: unknown = JSON.parse(canonicalContentText);
      const v2 = quizPackContentV2Schema.safeParse(raw);
      const result = v2.success ? v2 : quizPackContentSchema.safeParse(raw);
      return result.success && result.data.product.productId === productId
        ? result.data
        : null;
    } catch {
      return null;
    }
  }, [canonicalContentText, productId]);
  if (!content)
    return (
      <p role="alert">
        此修订暂不能转换为内容视图。原始固定正文仍保留在技术详情中；没有修改内容。
      </p>
    );
  return (
    <div className={styles.inspector}>
      <section aria-label="固定内容摘要">
        <h2>内容与素材</h2>
        <p>{content.product.title}</p>
        <dl className={styles.metrics}>
          <div>
            <dt>题目</dt>
            <dd>{content.questions.length}</dd>
          </div>
          <div>
            <dt>结果</dt>
            <dd>{content.results.length}</dd>
          </div>
          <div>
            <dt>素材</dt>
            <dd>{content.resources.length}</dd>
          </div>
        </dl>
        <p className={styles.note}>
          以下内容来自此固定修订，只供核对。题目与素材更新继续通过内容包创建新修订。
        </p>
      </section>
      <details className={styles.section} open>
        <summary>题目与选项 · {content.questions.length} 题</summary>
        <ol className={styles.questions}>
          {content.questions.map((question, index) => (
            <li key={question.id}>
              <details open={index === 0}>
                <summary>
                  <span>{index + 1}.</span> {question.prompt}
                </summary>
                <ul>
                  {question.options.map((option) => (
                    <li key={option.id}>{option.label}</li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ol>
      </details>
      <details className={styles.section}>
        <summary>结果目录 · {content.results.length} 项</summary>
        <ul className={styles.resources}>
          {content.results.map((result) => (
            <li key={result.id}>
              <strong>{result.label}</strong>
              <span className={styles.note}>结果标识：{result.id}</span>
            </li>
          ))}
        </ul>
      </details>
      <details className={styles.section} open>
        <summary>素材清单 · {content.resources.length} 项</summary>
        <p className={styles.note}>
          此处呈现包内资源声明，不表示平台已批准使用。实际画面请进入同一修订的体验预览。
        </p>
        <ul className={styles.resources}>
          {content.resources.map((resource) => (
            <li key={`${resource.id}/${resource.version}`}>
              <strong>{resource.id}</strong>
              <span>
                {resource.mediaType} · {resource.width} × {resource.height} ·{" "}
                {(resource.bytes / 1024).toFixed(1)} KB
              </span>
              <span className={styles.note}>
                包内审核声明：
                {resource.approval === "pending" ? "待审核" : resource.approval}{" "}
                · 版本 {resource.version}
              </span>
              <span className={styles.path}>{resource.path}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
