"use client";

import {
  ArrowRight,
  Check,
  FileText,
  List,
  Sparkles,
  Upload,
} from "lucide-react";
import type { ProductOperations } from "../operations/contracts";
import type { RevisionTarget } from "@/features/product/internal-versions/identity-contracts";
import { sameRevisionTarget } from "@/features/product/internal-versions/identity-contracts";
import type { ContentTaskState } from "./content-task-state";
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
  onInspectSource?: ((importId: string) => void) | undefined;
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
  onInspectSource,
  onPreview,
}: ContentWorkbenchProps) {
  const current =
    value?.content.draft.state === "present"
      ? value.content.draft.value
      : undefined;
  const retained = taskState?.retained || taskState?.pending;
  const reception = value?.content.reception.latest;
  const validation = value?.content.validation.latest;
  const matchedReview =
    current &&
    value?.review.current.state === "present" &&
    sameRevisionTarget(current.target, value.review.current.value.target);
  const receiveForCurrent =
    current &&
    reception?.state === "present" &&
    reception.value.id === current.sourceImportId;
  const checkForCurrent =
    current &&
    validation?.state === "present" &&
    validation.value.id === current.sourceValidationId &&
    validation.value.importId === current.sourceImportId;
  const states = [
    {
      label: "接收内容包",
      done: Boolean(
        receiveForCurrent &&
        reception?.state === "present" &&
        reception.value.status === "received" &&
        reception.value.storageCondition === "clean",
      ),
      detail: receiveForCurrent
        ? "当前来源已有接收记录"
        : current
          ? "当前来源接收需按记录核对"
          : reception?.state === "present"
            ? "已有独立接收记录"
            : "等待此步骤",
    },
    {
      label: "检查内容与素材",
      done: Boolean(
        checkForCurrent &&
        validation?.state === "present" &&
        validation.value.status === "ready" &&
        validation.value.storageCondition === "clean",
      ),
      detail: checkForCurrent
        ? "当前来源已有检查记录"
        : current
          ? "当前来源检查需按记录核对"
          : validation?.state === "present"
            ? "已有独立检查记录"
            : "完成前一步后继续",
    },
    {
      label: "建立内容草稿",
      done: !!current,
      detail: current ? "已有明确修订结果" : "完成前一步后继续",
    },
  ];
  const disabledImport =
    loading ||
    !!taskState?.busy ||
    (!retained &&
      (readOnly || !!value?.directory.archivedAt || !value || !!error));
  return (
    <div className={styles.workbench}>
      {error && (
        <p className={styles.warning} role="alert">
          内容摘要未能读取，原任务仍保留。请核实后继续。
        </p>
      )}
      <section className={styles.hero} aria-label="内容制作主任务">
        <div className={styles.eyebrow}>
          <Sparkles size={16} aria-hidden="true" />
          现在可以做什么
        </div>
        <h2>
          {retained
            ? "继续原内容任务"
            : current
              ? `当前内容 r${current.target.revision}，可以继续完善`
              : "从第一份内容包开始"}
        </h2>
        <p>
          {retained
            ? "本页保留着原文件和处理记录，请回到原任务继续。"
            : current
              ? "草稿修订是不可变的。重新导入并确认内容后会产生新的修订，不覆盖既有报告和历史审核。"
              : "先在外部制作 QuizPack，后台负责安全接收、检查素材与内容结构，再明确生成草稿修订。"}
        </p>
        {(taskState?.pending || taskState?.message) && (
          <p className={styles.warning} role="status">
            {taskState.message || "原操作尚待核实，不要以新操作替代。"}
          </p>
        )}
        <div className={styles.actions}>
          <button
            className={styles.primary}
            disabled={
              retained
                ? !!taskState?.busy
                : current
                  ? loading || previewBlocked
                  : disabledImport
            }
            onClick={
              current && !retained
                ? () => onPreview(current.target)
                : onOpenTask
            }
          >
            <ArrowRight size={17} aria-hidden="true" />
            {taskState?.busy
              ? "正在处理…"
              : retained
                ? "继续核实原任务"
                : current
                  ? `预览当前 r${current.target.revision}`
                  : "上传内容包"}
          </button>
          {current && !retained && (
            <button
              className={styles.secondary}
              disabled={disabledImport}
              onClick={onOpenTask}
            >
              <Upload size={17} aria-hidden="true" />
              更新内容包
            </button>
          )}
          <button className={styles.textButton} onClick={onOpenHistory}>
            查看修订历史
          </button>
        </div>
        {(readOnly || value?.directory.archivedAt) && (
          <p className={styles.caption}>
            当前不能发起新写入，已有任务与历史记录仍可核实。
          </p>
        )}
      </section>
      <section className={styles.panel} aria-label="内容处理进度">
        <div className={styles.cardHead}>
          <div>
            <h2>内容制作流程</h2>
            <p>每步有自己的确切记录，不以最近时间拼接完成状态。</p>
          </div>
          <span className={styles.badge}>
            {current ? `当前 r${current.target.revision}` : "尚无草稿"}
          </span>
        </div>
        <ol className={styles.flow}>
          {states.map((item, i) => (
            <li key={item.label}>
              <span className={item.done ? styles.done : styles.counter}>
                {item.done ? <Check size={15} aria-hidden="true" /> : i + 1}
              </span>
              <div>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </div>
            </li>
          ))}
        </ol>
        <div className={styles.division} />
        <div className={styles.sourceRow}>
          <div>
            <h3>如何开始？</h3>
            <p className={styles.caption}>
              在外部制作内容，再上传 QuizPack 压缩包。
            </p>
          </div>
          <button
            className={styles.secondary}
            onClick={onOpenImports ?? onOpenHistory}
          >
            <List size={17} aria-hidden="true" />
            接收 / 检查记录
          </button>
        </div>
      </section>
      <section className={styles.panel} aria-label="当前制作对象">
        <div className={styles.cardHead}>
          <div>
            <h2>当前内容</h2>
            <p>只突出最新准确对象，来源细节进入记录查看。</p>
          </div>
          <button className={styles.textButton} onClick={onOpenHistory}>
            完整历史
          </button>
        </div>
        {current ? (
          <>
            <div className={styles.valueTop}>
              <div>
                <span className={styles.caption}>当前不可变内容修订</span>
                <div className={styles.revision}>
                  r{current.target.revision}
                </div>
              </div>
              <span
                className={
                  matchedReview ? styles.greenBadge : styles.amberBadge
                }
              >
                {matchedReview ? "已有匹配审核记录" : "尚无匹配审核"}
              </span>
            </div>
            <div className={styles.sourceRow}>
              <div>
                <h3>此修订的内容来源</h3>
                <p className={styles.caption}>来源已固定，不随新内容包改变。</p>
              </div>
              {onInspectSource && (
                <button
                  className={styles.secondary}
                  onClick={() => onInspectSource(current.sourceImportId)}
                >
                  查看准确来源
                </button>
              )}
            </div>
          </>
        ) : (
          <div className={styles.empty}>
            <FileText size={28} aria-hidden="true" />
            <h3>
              {loading
                ? "正在读取当前内容"
                : value?.content.draft.state === "none"
                  ? "还没有内容草稿"
                  : "当前内容待核实"}
            </h3>
            <p>先完成内容包接收、检查，再明确生成草稿。</p>
          </div>
        )}
      </section>
    </div>
  );
}
