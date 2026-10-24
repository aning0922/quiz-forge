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
  onOpenTask: () => void;
  onOpenHistory: () => void;
  onPreview: (target: RevisionTarget) => void;
};
export function ContentWorkbench({
  value,
  loading,
  error,
  taskState,
  readOnly = false,
  onOpenTask,
  onOpenHistory,
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
      <section className={styles.hero} aria-label="内容制作主任务">
        <div>
          <p className={styles.eyebrow}>内容制作</p>
          <h2>
            {retained
              ? "继续本次内容任务"
              : current
                ? `预览当前 r${current.target.revision}`
                : "从内容包建立第一版草稿"}
          </h2>
          <p>接收 QuizPack，独立检查内容与素材，再确认形成固定修订。</p>
        </div>
        <button
          className={styles.primary}
          disabled={
            loading ||
            !!taskState?.busy ||
            (!retained &&
              !current &&
              (!!value?.directory.archivedAt || readOnly || !value || !!error))
          }
          onClick={
            current && !retained ? () => onPreview(current.target) : onOpenTask
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
      <div className={styles.columns}>
        <section className={styles.panel} aria-label="内容处理步骤">
          <h2>三步形成可预览的草稿</h2>
          <ol className={styles.flow}>
            <li>
              <strong>接收内容包</strong>
              <p>选择文件后，明确创建接收意图，再上传原文件。</p>
            </li>
            <li>
              <strong>检查内容与素材</strong>
              <p>独立检查包结构并保存素材；接收完成不等于检查通过。</p>
            </li>
            <li>
              <strong>确认形成修订</strong>
              <p>
                使用同一就绪来源创建 r1，或按固定基准追加。成功后预览真实修订。
              </p>
            </li>
          </ol>
        </section>
        <section className={styles.panel} aria-label="当前固定修订">
          <h2>当前固定修订</h2>
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
              <button
                className={styles.primary}
                onClick={() => onPreview(current.target)}
              >
                预览当前固定修订
              </button>
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
      </div>
    </div>
  );
}
