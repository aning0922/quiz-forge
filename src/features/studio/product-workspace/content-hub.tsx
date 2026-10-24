"use client";

import Link from "next/link";
import { useProductWorkspaceContext } from "./context";
import { draftRevisionPath } from "../drafts/client";
import { directoryTime } from "../workspace/directory-time";
import ui from "../workspace/workspace.module.css";
import styles from "./hubs.module.css";

const reception = {
  "awaiting-upload": "等待上传",
  receiving: "接收中",
  received: "已接收",
  "retryable-failed": "接收失败，需处理",
  rejected: "已拒绝",
};
const validation = {
  validating: "检查中",
  validated: "检查完成，资源尚未就绪",
  archiving: "资源封存中",
  ready: "资源已就绪",
  rejected: "检查未通过",
  "retryable-failed": "检查失败，需处理",
};

export function ProductContentHub() {
  const workspace = useProductWorkspaceContext();
  if (!workspace)
    return <p role="alert">未取得测评工作区，请返回测评管理重新进入。</p>;
  const { productId, read } = workspace;
  const base = `/studio/products/${encodeURIComponent(productId)}`;
  const value = read.value;
  const draft = value?.content.draft;
  const incoming = value?.content.reception.latest;
  const checked = value?.content.validation.latest;
  return (
    <div className={styles.hub}>
      <header>
        <h2>内容与素材</h2>
        <p>
          通过内容包更新题目与素材，选择具体修订核对内容。接收、检查和草稿分别保留记录。
        </p>
      </header>
      <div className={styles.flow} aria-label="内容处理顺序">
        <span>导入内容包</span>
        <span>检查与归档</span>
        <span>明确应用到草稿</span>
        <span>选择修订预览</span>
      </div>
      {read.loading && <p role="status">正在读取内容来源…</p>}
      {read.error && (
        <p role="alert">
          内容摘要未读取成功。原接收、草稿及待确认操作仍可在对应入口核实。
        </p>
      )}
      <div className={styles.columns}>
        <section className={ui.panel}>
          <h3>当前草稿</h3>
          {draft?.state === "present" ? (
            <>
              <p className={styles.emphasis}>
                修订 r{draft.value.target.revision}
              </p>
              <p>
                生成于 {directoryTime(draft.value.createdAt)}
                。此修订的题目、结果与素材集合可以单独核对。
              </p>
              <div className={ui.actions}>
                <Link
                  className={ui.link}
                  href={draftRevisionPath(
                    productId,
                    draft.value.target.draftId,
                    draft.value.target.revision,
                  )}
                >
                  查看此修订的内容与素材
                </Link>
                <Link
                  className={`${ui.link} ${ui.secondary}`}
                  href={`${base}/imports/${draft.value.sourceImportId}/validations/${draft.value.sourceValidationId}`}
                >
                  查看草稿来源检查
                </Link>
              </div>
            </>
          ) : draft?.state === "none" ? (
            <p>尚未形成草稿。完成内容包检查后，在检查结果页明确创建草稿。</p>
          ) : !read.loading && !read.error ? (
            <p>当前草稿暂不可判定，请核实原处理记录。</p>
          ) : null}
          <Link className={styles.textLink} href={`${base}/draft`}>
            修订历史与原操作核实 →
          </Link>
        </section>
        <section className={ui.panel}>
          <h3>导入或更新内容</h3>
          <p>
            内容包接收后需独立检查；检查完成后，明确选择创建草稿或追加新修订。已有修订保留。
          </p>
          {incoming?.state === "present" ? (
            <p>
              最近接收：{reception[incoming.value.status]} ·{" "}
              {directoryTime(incoming.value.createdAt)}
            </p>
          ) : incoming?.state === "none" ? (
            <p>暂无接收记录。</p>
          ) : null}
          <div className={ui.actions}>
            <Link className={ui.link} href={`${base}/imports`}>
              {value?.directory.archivedAt
                ? "查看接收记录"
                : "导入内容包与查看记录"}
            </Link>
            {incoming?.state === "present" && (
              <Link
                className={`${ui.link} ${ui.secondary}`}
                href={`${base}/imports/${incoming.value.id}`}
              >
                继续处理最近接收
              </Link>
            )}
          </div>
        </section>
      </div>
      {checked?.state === "present" && (
        <section className={ui.panel}>
          <h3>最近的独立检查</h3>
          <p>
            {validation[checked.value.status]} ·{" "}
            {directoryTime(checked.value.createdAt)}
          </p>
          <p>
            {draft?.state === "present" &&
            draft.value.sourceValidationId === checked.value.id
              ? "该检查记录是当前草稿的来源。"
              : "此检查记录与当前草稿分别保留，检查就绪也不会自动替换草稿。"}
          </p>
          {incoming?.state === "present" &&
            incoming.value.id !== checked.value.importId && (
              <p className={ui.note}>
                这条检查属于另一条接收记录，不能用它判断最近上传的内容是否通过。
              </p>
            )}
          <Link
            className={ui.link}
            href={`${base}/imports/${checked.value.importId}/validations/${checked.value.id}`}
          >
            打开此检查与草稿处理
          </Link>
        </section>
      )}
      <p className={ui.note}>
        查看结构化内容不会编辑题目或批准素材。需要核对实际画面时，请选择固定修订进入体验预览。
      </p>
    </div>
  );
}
