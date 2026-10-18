import Link from "next/link";
import type { DraftSummaryDto } from "@/features/product/drafts/contracts";
import type { AppendDraftBinding } from "@/features/product/draft-revisions/contracts";
import { draftRevisionPath } from "../drafts/client";
import { previewPagePath } from "@/features/product/preview/urls";
import styles from "../workspace/workspace.module.css";
export function RevisionLinks({ draft }: { draft: DraftSummaryDto }) {
  return (
    <div className={styles.actions}>
      <Link
        className={`${styles.link} ${styles.secondary}`}
        href={draftRevisionPath(draft.productId, draft.draftId, draft.revision)}
      >
        阅读修订 {draft.revision} 原文
      </Link>
      <Link
        className={`${styles.link} ${styles.secondary}`}
        href={previewPagePath(draft)}
      >
        预览修订 {draft.revision}
      </Link>
    </div>
  );
}
export function AppendBindingFacts({
  binding,
}: {
  binding: AppendDraftBinding;
}) {
  return (
    <dl className={styles.facts}>
      <div>
        <dt>原 key</dt>
        <dd>{binding.idempotencyKey}</dd>
      </div>
      <div>
        <dt>原来源 / 验证修订</dt>
        <dd>
          {binding.sourceImportId}
          <br />
          {binding.sourceValidationId} /{" "}
          {binding.expectedValidationStateRevision}
        </dd>
      </div>
      <div>
        <dt>原候选 SHA-256</dt>
        <dd>{binding.expectedCandidateSha256}</dd>
      </div>
      <div>
        <dt>固定草稿 / 基准修订</dt>
        <dd>
          {binding.target.draftId} / {binding.target.expectedRevision}
        </dd>
      </div>
      <div>
        <dt>基准内容 SHA-256</dt>
        <dd>{binding.target.expectedCanonicalContentSha256}</dd>
      </div>
      <div>
        <dt>基准素材集合 SHA-256</dt>
        <dd>{binding.target.expectedAssetSetSha256}</dd>
      </div>
    </dl>
  );
}
