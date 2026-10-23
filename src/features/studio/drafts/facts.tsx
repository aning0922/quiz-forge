import { TechnicalDetails } from "../presentation/technical-details";
import Link from "next/link";
import type { DraftSummaryDto } from "@/features/product/drafts/contracts";
import { draftRevisionPath } from "./client";
import styles from "../workspace/workspace.module.css";
export function DraftFacts({ draft }: { draft: DraftSummaryDto }) {
  return (
    <>
      <p className={styles.note}>
        {draft.contentKind === "authored" ? "作者内容" : "合成内容"} · 草稿修订{" "}
        {draft.revision}
        。此页只读。草稿与固定内测内容版本分别管理；草稿本身不表示具备对外发布资格。
      </p>
      <p>当前内容：修订 {draft.revision}</p>
      <dl className={styles.facts}>
        <div>
          <dt>包 / 版本</dt>
          <dd>
            {draft.packId} / {draft.packVersion}
          </dd>
        </div>

        <div>
          <dt>素材数量</dt>
          <dd>{draft.resourceCount}</dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd>{draft.createdAt}</dd>
        </div>
      </dl>
      <TechnicalDetails label="草稿来源与版本技术信息">
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
            <dt>固定版本</dt>
            <dd>
              逻辑 {draft.versions.contentVersion} · 视觉{" "}
              {draft.versions.visualVersion} · 报告{" "}
              {draft.versions.reportVersion} · 素材{" "}
              {draft.versions.resourceVersion} · 组件{" "}
              {draft.versions.componentVersion} · 引擎{" "}
              {draft.versions.engine.id} / {draft.versions.engine.version}
            </dd>
          </div>
        </dl>
      </TechnicalDetails>
      <TechnicalDetails label="草稿校验摘要">
        <dl className={styles.facts}>
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
        </dl>
      </TechnicalDetails>
      <p>下一步：选择此固定修订阅读正文，再进入预览或内测审核依据记录。</p>
      <Link
        className={styles.link}
        href={draftRevisionPath(draft.productId, draft.draftId, draft.revision)}
      >
        查看此修订内容
      </Link>
    </>
  );
}
