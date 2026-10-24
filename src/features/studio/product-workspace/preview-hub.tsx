"use client";

import Link from "next/link";
import type { RevisionTarget } from "@/features/product/internal-versions/identity-contracts";
import { previewPagePath } from "@/features/product/preview/urls";
import { useProductWorkspaceContext } from "./context";
import { draftRevisionPath } from "../drafts/client";
import ui from "../workspace/workspace.module.css";
import styles from "./hubs.module.css";

function PreviewChoice({
  productId,
  target,
  title,
  description,
}: {
  productId: string;
  target: RevisionTarget;
  title: string;
  description: string;
}) {
  return (
    <section className={ui.panel}>
      <h3>{title}</h3>
      <p className={styles.emphasis}>固定修订 r{target.revision}</p>
      <p>{description}</p>
      <div className={ui.actions}>
        <Link
          className={ui.link}
          href={previewPagePath({ productId, ...target })}
        >
          打开 r{target.revision} 体验预览
        </Link>
        <Link
          className={`${ui.link} ${ui.secondary}`}
          href={draftRevisionPath(productId, target.draftId, target.revision)}
        >
          先核对此修订内容
        </Link>
      </div>
    </section>
  );
}

export function ProductPreviewHub() {
  const workspace = useProductWorkspaceContext();
  if (!workspace)
    return <p role="alert">未取得测评工作区，请返回测评管理重新进入。</p>;
  const { productId, read } = workspace;
  const draft = read.value?.content.draft;
  const historical = read.value?.versions.historical;
  return (
    <div className={styles.hub}>
      <header>
        <h2>体验预览</h2>
        <p>
          明确选择一个修订再进入预览。打开后固定在所选内容，新的草稿不会替换正在预览的对象。
        </p>
      </header>
      {read.loading && <p role="status">正在读取可选择的修订…</p>}
      {read.error && (
        <p role="alert">
          修订摘要暂不可用，请在工作区顶部重新读取，或到修订历史核实。
        </p>
      )}
      <div className={styles.columns}>
        {draft?.state === "present" && (
          <PreviewChoice
            productId={productId}
            target={draft.value.target}
            title="当前草稿修订"
            description="检查当前题目、结果与视觉效果。是否可渲染仍由固定预览接口核实。"
          />
        )}
        {historical?.state === "present" && (
          <PreviewChoice
            productId={productId}
            target={historical.value.target}
            title="历史固定版本的来源修订"
            description="核对历史固定内容对应的草稿修订。此处不覆盖历史版本，也不切换已有答题版本。"
          />
        )}
      </div>
      {draft?.state === "none" && (
        <section className={ui.panel}>
          <h3>尚无可选择的草稿</h3>
          <p>先导入并检查内容，再明确创建草稿修订。</p>
          <Link
            className={ui.link}
            href={`/studio/products/${encodeURIComponent(productId)}/content`}
          >
            进入内容与素材
          </Link>
        </section>
      )}
      <section className={ui.panel}>
        <h3>查看其他修订</h3>
        <p>修订历史保留每个固定对象的内容和预览入口，可按修订号选择。</p>
        <Link
          className={`${ui.link} ${ui.secondary}`}
          href={`/studio/products/${encodeURIComponent(productId)}/draft`}
        >
          打开完整修订历史
        </Link>
      </section>
      <p className={ui.note}>
        预览不会登记“已人工体验”，也不会自动形成审核依据、消费者报告或公开发布资格。审核与版本操作仍需明确执行。
      </p>
    </div>
  );
}
