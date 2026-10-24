"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Observation } from "../operations/contracts";
import type { PresentationStatus } from "../operations-ui/presentation";
import { StatusBadge } from "../operations-ui/status-badge";
import { TechnicalDetails } from "../presentation/technical-details";
import { useProductWorkspaceContext } from "./context";
import { draftRevisionPath } from "../drafts/client";
import { directoryTime } from "../workspace/directory-time";
import styles from "./hubs.module.css";

const receptionLabels = {
  "awaiting-upload": "等待上传",
  receiving: "接收中",
  received: "已接收",
  "retryable-failed": "接收失败，需处理",
  rejected: "已拒绝",
};
const validationLabels = {
  validating: "检查中",
  validated: "检查完成，资源尚未就绪",
  archiving: "资源封存中",
  ready: "资源已就绪",
  rejected: "检查未通过",
  "retryable-failed": "检查失败，需处理",
};
function observationStatus<T>(
  observation: Observation<T> | undefined,
  absent: string,
  loading: boolean,
  present: (value: T) => PresentationStatus,
): PresentationStatus {
  if (observation?.state === "present") return present(observation.value);
  if (observation?.state === "none") return { label: absent, tone: "neutral" };
  return {
    label: loading ? "正在读取" : "状态待核实",
    tone: loading ? "neutral" : "warning",
  };
}

export function ProductContentHub() {
  const workspace = useProductWorkspaceContext();
  if (!workspace)
    return <p role="alert">未取得测评工作区，请返回测评管理重新进入。</p>;
  const { productId, read } = workspace;
  const base = `/studio/products/${encodeURIComponent(productId)}`;
  const value = read.value,
    draft = value?.content.draft,
    incoming = value?.content.reception.latest,
    checked = value?.content.validation.latest;
  const separateSources =
    incoming?.state === "present" &&
    checked?.state === "present" &&
    incoming.value.id !== checked.value.importId;
  const sourceMatchesDraft =
    draft?.state === "present" &&
    checked?.state === "present" &&
    draft.value.sourceImportId === checked.value.importId &&
    draft.value.sourceValidationId === checked.value.id;
  return (
    <div className={styles.hub}>
      {read.loading && (
        <p role="status" className={styles.notice}>
          正在读取内容来源…
        </p>
      )}
      {read.error && (
        <p role="alert" className={styles.error}>
          内容摘要未读取成功。原接收、草稿及待确认操作仍可在对应入口核实。
        </p>
      )}
      <div className={styles.columns}>
        <section className={styles.panel} aria-label="内容制作流程">
          <div className={styles.sectionHead}>
            <h2>内容制作</h2>
            <StatusBadge status={{ label: "QuizPack 内容包", tone: "info" }} />
          </div>
          <p className={styles.intro}>
            接收、检查后，需明确确认创建或追加草稿。以下各行保留自己的来源。
          </p>
          <ol className={styles.stepList}>
            <li>
              <span className={styles.counter} aria-hidden="true">
                1
              </span>
              <div className={styles.stepBody}>
                <div className={styles.rowHead}>
                  <h3>接收内容包</h3>
                  <StatusBadge
                    status={observationStatus(
                      incoming,
                      "暂无接收",
                      read.loading,
                      (item) => ({
                        label:
                          item.storageCondition === "clean"
                            ? receptionLabels[item.status]
                            : "接收存储待核实",
                        tone:
                          item.storageCondition !== "clean" ||
                          item.status === "retryable-failed" ||
                          item.status === "rejected"
                            ? "warning"
                            : "info",
                      }),
                    )}
                  />
                </div>
                <p>匹配测评身份，安全接收原始文件。</p>
                {incoming?.state === "present" && (
                  <>
                    <p className={styles.muted}>
                      最近接收 ·{" "}
                      <time dateTime={incoming.value.createdAt}>
                        {directoryTime(incoming.value.createdAt)}
                      </time>
                    </p>
                    <Link
                      className={styles.textLink}
                      href={`${base}/imports/${incoming.value.id}`}
                    >
                      查看这条接收
                    </Link>
                  </>
                )}
              </div>
            </li>
            <li>
              <span className={styles.counter} aria-hidden="true">
                2
              </span>
              <div className={styles.stepBody}>
                <div className={styles.rowHead}>
                  <h3>检查内容与素材</h3>
                  <StatusBadge
                    status={observationStatus(
                      checked,
                      "暂无检查",
                      read.loading,
                      (item) => ({
                        label:
                          item.storageCondition === "clean"
                            ? validationLabels[item.status]
                            : "检查存储待核实",
                        tone:
                          item.storageCondition !== "clean" ||
                          item.status === "rejected" ||
                          item.status === "retryable-failed"
                            ? "warning"
                            : "info",
                      }),
                    )}
                  />
                </div>
                <p>独立核对题目、规则与资源；就绪不会自动形成草稿。</p>
                {checked?.state === "present" && (
                  <>
                    <p className={styles.muted}>
                      独立检查 ·{" "}
                      <time dateTime={checked.value.createdAt}>
                        {directoryTime(checked.value.createdAt)}
                      </time>
                    </p>
                    <Link
                      className={styles.textLink}
                      href={`${base}/imports/${checked.value.importId}/validations/${checked.value.id}`}
                    >
                      查看这条检查
                    </Link>
                  </>
                )}
                {separateSources && (
                  <p className={styles.warning}>
                    此检查与上方最近接收不是同一来源，不能据此判断新上传内容已通过。
                  </p>
                )}
              </div>
            </li>
            <li>
              <span className={styles.counter} aria-hidden="true">
                3
              </span>
              <div className={styles.stepBody}>
                <div className={styles.rowHead}>
                  <h3>明确形成草稿修订</h3>
                  <StatusBadge
                    status={observationStatus(
                      draft,
                      "尚未形成",
                      read.loading,
                      (item) => ({
                        label: `当前 r${item.target.revision}`,
                        tone: "info",
                      }),
                    )}
                  />
                </div>
                <p>
                  {draft?.state === "present"
                    ? "已形成独立的固定修订；来源见右侧，历史内容保持不变。"
                    : "在检查结果页明确选择创建草稿或追加修订。"}
                </p>
                <Link className={styles.textLink} href={`${base}/draft`}>
                  修订历史与原操作核实
                </Link>
              </div>
            </li>
          </ol>
          <Link className={styles.primary} href={`${base}/imports`}>
            {value?.directory.archivedAt
              ? "查看内容接收记录"
              : "进入内容包处理"}
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </section>
        <section className={styles.panel} aria-label="当前修订与来源">
          <div className={styles.sectionHead}>
            <h2>当前修订与来源</h2>
          </div>
          {draft?.state === "present" ? (
            <>
              <div className={styles.revisionCard}>
                <StatusBadge status={{ label: "当前草稿", tone: "info" }} />
                <h3>固定修订 r{draft.value.target.revision}</h3>
                <p>
                  形成于{" "}
                  <time dateTime={draft.value.createdAt}>
                    {directoryTime(draft.value.createdAt)}
                  </time>
                </p>
              </div>
              <p className={styles.intro}>
                题目、结果与素材集合属于此修订，可单独核对。
              </p>
              <Link
                className={styles.secondary}
                href={draftRevisionPath(
                  productId,
                  draft.value.target.draftId,
                  draft.value.target.revision,
                )}
              >
                查看此修订内容与素材
              </Link>
              <div className={styles.sourceLinks}>
                <Link
                  className={styles.textLink}
                  href={`${base}/imports/${draft.value.sourceImportId}`}
                >
                  草稿来源接收
                </Link>
                <Link
                  className={styles.textLink}
                  href={`${base}/imports/${draft.value.sourceImportId}/validations/${draft.value.sourceValidationId}`}
                >
                  草稿来源检查
                </Link>
              </div>
              <p className={styles.muted}>
                {sourceMatchesDraft
                  ? "左侧独立检查正是此草稿的来源。"
                  : "此草稿有自己的来源检查，不随最近接收或检查记录切换。"}
              </p>
            </>
          ) : draft?.state === "none" ? (
            <div className={styles.empty}>
              <h3>尚未形成草稿</h3>
              <p>
                完成内容检查后，请在原检查结果页确认形成修订。检查就绪不等于已创建草稿。
              </p>
            </div>
          ) : (
            <p className={styles.muted}>
              {read.loading
                ? "正在读取当前修订…"
                : "当前修订无法判定，请重新读取摘要或核实原记录。"}
            </p>
          )}
          <TechnicalDetails label="来源身份与技术依据">
            <dl className={styles.technicalFacts}>
              {incoming?.state === "present" && (
                <>
                  <dt>最近接收编号</dt>
                  <dd>
                    {incoming.value.id} · 状态版本{" "}
                    {incoming.value.stateRevision}
                  </dd>
                </>
              )}
              {checked?.state === "present" && (
                <>
                  <dt>独立检查编号 / 来源接收</dt>
                  <dd>
                    {checked.value.id} / {checked.value.importId}
                  </dd>
                </>
              )}
              {draft?.state === "present" && (
                <>
                  <dt>当前草稿编号</dt>
                  <dd>{draft.value.target.draftId}</dd>
                  <dt>草稿来源接收 / 检查</dt>
                  <dd>
                    {draft.value.sourceImportId} /{" "}
                    {draft.value.sourceValidationId}
                  </dd>
                  <dt>来源检查状态版本</dt>
                  <dd>{draft.value.sourceValidationStateRevision}</dd>
                </>
              )}
            </dl>
          </TechnicalDetails>
          <p className={styles.caption}>
            查看结构化内容不会编辑题目或批准素材。实际画面请在体验预览中选择固定修订。
          </p>
        </section>
      </div>
    </div>
  );
}
