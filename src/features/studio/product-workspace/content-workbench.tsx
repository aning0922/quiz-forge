"use client";

import type { ProductOperations } from "../operations/contracts";
import type { RevisionTarget } from "@/features/product/internal-versions/identity-contracts";
import type { ContentTaskState } from "./content-task-state";
import { directoryTime } from "../workspace/directory-time";
import styles from "./content-workbench.module.css";

export type ContentWorkbenchProps = {
  value: ProductOperations | undefined;
  loading: boolean;
  error?: string | undefined;
  taskState?: ContentTaskState | undefined;
  readOnly?: boolean;
  previewBlocked?: boolean;
  onOpenTask: () => void;
  onOpenHistory: () => void;
  onOpenImports?: (() => void) | undefined;
  onPreview: (target: RevisionTarget) => void;
};
export function ContentWorkbench({
  value,
  loading,
  error,
  taskState,
  readOnly = false,
  previewBlocked = false,
  onOpenTask,
  onOpenHistory,
  onOpenImports,
  onPreview,
}: ContentWorkbenchProps) {
  const draft = value?.content.draft;
  const current = draft?.state === "present" ? draft.value : undefined;
  const retained = taskState?.retained || taskState?.pending;
  return (
    <div className={styles.workbench}>
      {error && (
        <p className={styles.warning} role="alert">
          内容摘要未读取成功。保留的任务和原操作不受影响，请先核实。
        </p>
      )}
      <div className={styles.columns}>
        <div className={styles.stack}>
          <section className={styles.hero} aria-label="内容制作主任务">
            <div>
              <p className={styles.eyebrow}>内容制作</p>
              <h2>
                {retained
                  ? "继续本次内容任务"
                  : current
                    ? `继续制作当前 r${current.target.revision}`
                    : "从内容包建立第一版草稿"}
              </h2>
              <p>
                {current
                  ? "当前修订已可体验。预览、审核依据与固定内测版本分别核对，历史记录保持。"
                  : "上传制作好的 QuizPack，在同一个任务中完成接收、检查和建立草稿。"}
              </p>
            </div>
            <button
              className={styles.primary}
              disabled={
                loading ||
                (!!current && !retained && previewBlocked) ||
                !!taskState?.busy ||
                (!retained &&
                  !current &&
                  (!!value?.directory.archivedAt ||
                    readOnly ||
                    !value ||
                    !!error))
              }
              onClick={
                current && !retained
                  ? () => onPreview(current.target)
                  : onOpenTask
              }
            >
              {taskState?.busy
                ? "任务正在处理…"
                : retained
                  ? "继续处理 / 核实原操作"
                  : current
                    ? `预览当前 r${current.target.revision}`
                    : "选择内容包并开始"}
            </button>
            {current && !retained && (
              <button
                className={styles.secondary}
                disabled={
                  loading ||
                  !!taskState?.busy ||
                  !!value?.directory.archivedAt ||
                  readOnly ||
                  !!error
                }
                onClick={onOpenTask}
              >
                导入新内容包
              </button>
            )}
            {(taskState?.pending || taskState?.message) && (
              <p className={styles.warning} role="status">
                {taskState.message ||
                  "本次任务尚未结束。原文件、检查来源和原操作继续保留，请打开原任务处理。"}
              </p>
            )}
            {(readOnly || value?.directory.archivedAt) && (
              <p className={styles.intro}>
                当前不可发起新内容写入；历史修订和已有任务的核实入口继续保留。
              </p>
            )}
          </section>
          <section className={styles.panel} aria-label="内容处理步骤">
            <h2>内容处理步骤</h2>
            <ol className={styles.flow}>
              <li>
                <strong>接收内容包</strong>
                <p>先登记文件，再明确上传。</p>
              </li>
              <li>
                <strong>检查内容与素材</strong>
                <p>检查包结构并保存素材。</p>
              </li>
              <li>
                <strong>确认形成修订</strong>
                <p>从就绪来源创建或追加草稿。</p>
              </li>
            </ol>
            <button
              className={styles.secondary}
              onClick={onOpenImports ?? onOpenHistory}
            >
              接收与检查记录
            </button>
          </section>
        </div>
        <div className={styles.stack}>
          <section className={styles.panel} aria-label="当前固定修订">
            <h2>当前制作对象</h2>
            {current ? (
              <>
                <p className={styles.revision}>r{current.target.revision}</p>
                <p>
                  形成于{" "}
                  <time dateTime={current.createdAt}>
                    {directoryTime(current.createdAt)}
                  </time>
                </p>
                <p className={styles.intro}>
                  本修订有独立来源，不随最近接收或检查记录切换。
                </p>
              </>
            ) : (
              <p className={styles.intro}>
                {loading
                  ? "正在读取当前草稿…"
                  : draft?.state === "none"
                    ? "尚未形成草稿。完成左侧内容任务后在此预览。"
                    : "当前修订待核实，尚不能选择预览目标。"}
              </p>
            )}
            <button className={styles.secondary} onClick={onOpenHistory}>
              查看历史修订与来源
            </button>
          </section>
          <section className={styles.panel}>
            <h2>保留的历史</h2>
            <p>
              {value?.versions.historical.state === "present"
                ? `历史 r${value.versions.historical.value.target.revision} 已有固定内容，不随当前草稿变化。`
                : "本次摘要没有历史固定版本。已有记录仍可按准确对象查询。"}
            </p>
            <p className={styles.intro}>
              检查就绪不等于人工审核通过；以对应修订的真实依据为准。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
