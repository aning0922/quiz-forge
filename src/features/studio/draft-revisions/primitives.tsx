import type { RevisionTarget } from "@/features/product/internal-versions/identity-contracts";
import compact from "../product-workspace/content-workbench.module.css";
import Link from "next/link";
import type { DraftSummaryDto } from "@/features/product/drafts/contracts";
import type { AppendDraftBinding } from "@/features/product/draft-revisions/contracts";
import { draftRevisionPath } from "../drafts/client";
import { previewPagePath } from "@/features/product/preview/urls";
import styles from "../workspace/workspace.module.css";
export function RevisionLinks({
  draft,
  embedded = false,
  onPreview,
  onInspectRevision,
  onInspectSource,
}: {
  draft: DraftSummaryDto;
  embedded?: boolean;
  onPreview?: ((target: RevisionTarget) => void) | undefined;
  onInspectRevision?: ((target: RevisionTarget) => void) | undefined;
  onInspectSource?: ((importId: string) => void) | undefined;
}) {
  if (embedded) {
    const target = {
      draftId: draft.draftId,
      revision: draft.revision,
      canonicalContentSha256: draft.canonicalContentSha256,
      assetSetSha256: draft.assetSetSha256,
      canonicalManifestSha256: draft.canonicalManifestSha256,
    };
    return (
      <div className={compact.actions}>
        {onInspectRevision && (
          <button
            className={compact.secondary}
            onClick={() => onInspectRevision(target)}
          >
            查看修订 r{draft.revision}
          </button>
        )}
        {onPreview && (
          <button
            className={compact.secondary}
            onClick={() => onPreview(target)}
          >
            预览 r{draft.revision}
          </button>
        )}
        {onInspectSource && (
          <button
            className={compact.textButton}
            onClick={() => onInspectSource(draft.sourceImportId)}
          >
            查看原来源
          </button>
        )}
      </div>
    );
  }
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
        <dt>原操作编号</dt>
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
