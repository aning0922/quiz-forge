import Link from "next/link";
import type {
  InternalReviewReceipt,
  InternalVersionList,
  InternalVersionReceipt,
  RevisionTarget,
} from "@/features/product/internal-versions/contracts";
import { internalReviewPageUrl, internalVersionPageUrl } from "./paths";
import type { InternalRequest } from "./request";
import {
  INTERNAL_VERSION_DISCLOSURE,
  reviewApprovalPresentation,
  versionRevisionRelation,
} from "./view-state";
import styles from "../workspace/workspace.module.css";
import local from "./internal-versions.module.css";
export function TargetFacts({ target }: { target: RevisionTarget }) {
  return (
    <dl className={styles.facts}>
      <div>
        <dt>固定草稿 / 修订</dt>
        <dd>
          {target.draftId} / {target.revision}
        </dd>
      </div>
      <div>
        <dt>内容 SHA-256</dt>
        <dd>{target.canonicalContentSha256}</dd>
      </div>
      <div>
        <dt>素材集合 SHA-256</dt>
        <dd>{target.assetSetSha256}</dd>
      </div>
      <div>
        <dt>manifest SHA-256</dt>
        <dd>{target.canonicalManifestSha256}</dd>
      </div>
    </dl>
  );
}
export function RequestFacts({ request }: { request: InternalRequest }) {
  return (
    <details className={local.details}>
      <summary>原请求完整绑定</summary>
      <pre className={local.code}>{JSON.stringify(request.tuple, null, 2)}</pre>
    </details>
  );
}
export function ReviewFacts({ review }: { review: InternalReviewReceipt }) {
  const approval = reviewApprovalPresentation(review);
  return (
    <div className={local.receipt} data-internal-review={review.id}>
      <h3>{approval.label}</h3>
      <p>{INTERNAL_VERSION_DISCLOSURE}</p>
      <dl className={styles.facts}>
        <div>
          <dt>既有证据来源</dt>
          <dd>{approval.source}</dd>
        </div>
        <div>
          <dt>作者批准日期</dt>
          <dd>{approval.approvedOn ?? "不适用：合成测试不表示作者批准"}</dd>
        </div>
        <div>
          <dt>证据 SHA-256</dt>
          <dd>{review.facts.approval.evidenceSha256}</dd>
        </div>
        <div>
          <dt>运营记录人 / 时间</dt>
          <dd>
            {approval.recordedBy} / {approval.recordedAt}
          </dd>
        </div>
        <div>
          <dt>固定基线身份</dt>
          <dd>
            {review.binding.baseline.id} / {review.binding.baseline.version}
            <br />
            {review.binding.baseline.entrySha256}
          </dd>
        </div>
        <div>
          <dt>基线记录 ID / 事实 SHA-256</dt>
          <dd>
            {review.id}
            <br />
            {review.reviewSha256}
          </dd>
        </div>
      </dl>
    </div>
  );
}
export function VersionReceiptFacts({
  version,
}: {
  version: InternalVersionReceipt;
}) {
  return (
    <div className={local.receipt} data-internal-version={version.id}>
      <h3>固定内测版本 · 槽位 {version.slot}</h3>
      <p>{INTERNAL_VERSION_DISCLOSURE}</p>
      <p>对外发布批准：未授予</p>
      <dl className={styles.facts}>
        <div>
          <dt>版本 ID</dt>
          <dd>{version.id}</dd>
        </div>
        <div>
          <dt>快照 SHA-256</dt>
          <dd>{version.snapshotSha256}</dd>
        </div>
        <div>
          <dt>封存操作人 / 时间</dt>
          <dd>
            {version.createdBy} / {version.createdAt}
          </dd>
        </div>
      </dl>
      <Link
        className={styles.link}
        href={internalVersionPageUrl(version.binding.productId, version.id)}
      >
        阅读固定内测版本
      </Link>
    </div>
  );
}
export function VersionMetadataFacts({
  version,
  currentRevision,
}: {
  version: InternalVersionList["versions"][number];
  currentRevision?: number | undefined;
}) {
  return (
    <article className={styles.card}>
      <h3>
        槽位 {version.slot} · 来源修订 {version.target.revision}
      </h3>
      <p>{versionRevisionRelation(version.target.revision, currentRevision)}</p>
      <p>固定快照：{version.snapshotSha256}</p>
      <p>
        渲染器：{version.renderer.id} / {version.renderer.version}；能力：仅
        Studio 内部预览
      </p>
      <p>
        评分引擎：{version.engine.id} / {version.engine.version}
      </p>
      <p>封存时间：{version.createdAt}；对外发布批准：未授予</p>
      <div className={styles.actions}>
        <Link
          className={styles.link}
          href={internalVersionPageUrl(version.productId, version.id)}
        >
          阅读固定内测版本
        </Link>
        <Link
          className={`${styles.link} ${styles.secondary}`}
          href={internalReviewPageUrl({
            productId: version.productId,
            draftId: version.target.draftId,
            revision: version.target.revision,
          })}
        >
          阅读来源修订基线记录
        </Link>
      </div>
    </article>
  );
}
