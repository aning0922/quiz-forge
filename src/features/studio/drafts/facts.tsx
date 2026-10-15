import Link from "next/link";
import type { DraftSummaryDto } from "@/features/product/drafts/contracts";
import { draftRevisionPath } from "./client";
import styles from "../workspace/workspace.module.css";
export function DraftFacts({ draft }: { draft: DraftSummaryDto }) {
  return (
    <>
      <p className={styles.note}>
        {draft.contentKind === "authored" ? "作者内容" : "合成内容"} ·{" "}
        {draft.contentSchemaVersion} · 平台授权未审核 ·
        不可发布。此页只读，不运行评分、消费者预览或发布。
      </p>
      <dl className={styles.facts}>
        <div>
          <dt>草稿 / 修订</dt>
          <dd>
            {draft.draftId} / {draft.revision}
          </dd>
        </div>
        <div>
          <dt>来源归档</dt>
          <dd>
            {draft.sourceImportId}
            <br />
            {draft.sourceValidationId}
          </dd>
        </div>
        <div>
          <dt>包 / 版本</dt>
          <dd>
            {draft.packId} / {draft.packVersion}
          </dd>
        </div>
        <div>
          <dt>固定版本</dt>
          <dd>
            逻辑 {draft.versions.contentVersion} · 视觉{" "}
            {draft.versions.visualVersion} · 报告 {draft.versions.reportVersion}{" "}
            · 素材 {draft.versions.resourceVersion} · 组件{" "}
            {draft.versions.componentVersion} · 引擎 {draft.versions.engine.id}{" "}
            / {draft.versions.engine.version}
          </dd>
        </div>
        <div>
          <dt>内容 SHA-256</dt>
          <dd>{draft.canonicalContentSha256}</dd>
        </div>
        <div>
          <dt>素材集合 SHA-256</dt>
          <dd>{draft.assetSetSha256}</dd>
        </div>
        <div>
          <dt>候选 SHA-256</dt>
          <dd>{draft.candidateSha256}</dd>
        </div>
        <div>
          <dt>资源数</dt>
          <dd>{draft.resourceCount}</dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{draft.createdAt}</dd>
        </div>
      </dl>
      <Link
        className={styles.link}
        href={draftRevisionPath(draft.productId, draft.draftId, draft.revision)}
      >
        读取固定修订正文
      </Link>
    </>
  );
}
