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
  onOpenVersions?: (() => void) | undefined;
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
  onOpenVersions,
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
  const historical =
    value?.versions.historical.state === "present"
      ? value.versions.historical.value
      : undefined;
  return (
    <div className={styles.workbench}>
      <div className={styles.introHeader}>
        <div>
          <h2>内容制作</h2>
          <p>只突出当前需要完成的任务。检查历史与不可变来源放在记录详情中。</p>
        </div>
        <button
          className={styles.secondary}
          disabled={disabledImport}
          onClick={onOpenTask}
        >
          <Upload size={17} />
          导入新内容
        </button>
      </div>
      {error && (
        <p className={styles.warning} role="alert">
          内容摘要未能读取，原任务仍保留。请核实后继续。
        </p>
      )}
      <div className={styles.columns}>
        <div className={styles.stack}>
          <section className={styles.hero} aria-label="内容制作主任务">
            <div className={styles.eyebrow}>
              <Sparkles size={16} />
              现在可以做什么
            </div>
            <h2>
              {retained
                ? "继续处理本次内容"
                : current
                  ? `继续制作当前 r${current.target.revision} 版`
                  : "开始制作这款测评"}
            </h2>
            <p>
              {retained
                ? "本页保留着原文件和处理记录，请回到原任务继续。"
                : current
                  ? `当前 r${current.target.revision} 是固定修订；更新内容会形成新修订，历史记录保持。`
                  : "上传已经制作好的内容包，在同一任务窗口内完成接收、检查与建立草稿。"}
            </p>
            {(taskState?.pending || taskState?.message) && (
              <p className={styles.warning} role="status">
                {taskState.message ||
                  "本次操作尚待核实，请保留原任务，不要用新的操作替代。"}
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
                <ArrowRight size={17} />
                {taskState?.busy
                  ? "正在处理…"
                  : retained
                    ? "继续核实原任务"
                    : current
                      ? `预览当前 r${current.target.revision}`
                      : "上传内容包"}
              </button>
              <button className={styles.secondary} onClick={onOpenHistory}>
                查看内容修订
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
                <h3>内容处理进度</h3>
                <p>各步骤按自己的准确来源记录，不以最近时间拼接完成状态。</p>
              </div>
              <span className={styles.badge}>
                {current ? `当前 r${current.target.revision}` : "尚无草稿"}
              </span>
            </div>
            <ol className={styles.flow}>
              {states.map((item, i) => (
                <li key={item.label}>
                  <span className={item.done ? styles.done : styles.counter}>
                    {item.done ? <Check size={15} /> : i + 1}
                  </span>
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </div>
                </li>
              ))}
            </ol>
            <div className={styles.division} />
            <div className={styles.actions}>
              <button
                className={styles.secondary}
                disabled={disabledImport}
                onClick={onOpenTask}
              >
                <Upload size={17} />
                {current ? "更新内容包" : "上传内容包"}
              </button>
              <button
                className={styles.secondary}
                onClick={onOpenImports ?? onOpenHistory}
              >
                <List size={17} />
                接收与检查记录
              </button>
            </div>
          </section>
        </div>
        <aside className={styles.stack}>
          <section className={styles.panel} aria-label="当前制作对象">
            <div className={styles.cardHead}>
              <div>
                <h3>当前制作对象</h3>
                <p>摘要信息，完整来源在记录中查看。</p>
              </div>
            </div>
            {current ? (
              <>
                <div className={styles.valueTop}>
                  <div>
                    <span className={styles.caption}>当前内容修订</span>
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
                <div className={styles.miniStats}>
                  <div>
                    <small>来源内容包</small>
                    <strong>
                      {onInspectSource ? (
                        <button
                          className={styles.textButton}
                          onClick={() =>
                            onInspectSource(current.sourceImportId)
                          }
                        >
                          查看准确来源
                        </button>
                      ) : (
                        "已固定来源，详见修订记录"
                      )}
                    </strong>
                  </div>
                  <div>
                    <small>已有固定内测版本</small>
                    <strong>
                      {value
                        ? `${value.versions.currentCount + value.versions.historicalCount} 个`
                        : "待核实"}
                    </strong>
                  </div>
                </div>
              </>
            ) : (
              <div className={styles.empty}>
                <FileText size={29} />
                <h3>{loading ? "正在读取当前内容" : "还没有内容草稿"}</h3>
                <p>先完成内容包接收、检查，再明确生成草稿。</p>
              </div>
            )}
            <div className={styles.division} />
            <button
              className={`${styles.secondary} ${styles.block}`}
              onClick={onOpenHistory}
            >
              查看来源与修订记录
            </button>
          </section>
          <section className={styles.panel}>
            <h3>保留的历史</h3>
            {historical ? (
              <div className={styles.historyRow}>
                <div>
                  <strong>历史 r{historical.target.revision} 内容</strong>
                  <small>已固定，不随当前修订改变</small>
                </div>
                {onOpenVersions && (
                  <button className={styles.secondary} onClick={onOpenVersions}>
                    查看
                  </button>
                )}
              </div>
            ) : (
              <p className={styles.intro}>暂无可确认的历史固定版本。</p>
            )}
            <p className={styles.hint}>
              内容检查完成不代表人工审核通过；完整审核依据由现有版本服务维护。
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
