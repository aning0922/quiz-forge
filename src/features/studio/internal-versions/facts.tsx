import { directoryTime } from "../workspace/directory-time";
import { TechnicalDetails } from "../presentation/technical-details";
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
    <>
      <dl className={styles.facts}>
        <div>
          <dt>固定草稿 / 修订</dt>
          <dd>修订 {target.revision}</dd>
        </div>
      </dl>
      <TechnicalDetails label="内容版本技术信息">
        <p>草稿标识：{target.draftId}</p>
        <dl className={styles.facts}>
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
      </TechnicalDetails>
    </>
  );
}
export function RequestFacts({ request }: { request: InternalRequest }) {
  return (
    <>
      <p>操作目标：草稿修订 {request.tuple.target.revision}</p>
      <TechnicalDetails label="原操作完整绑定">
        <pre className={local.code}>
          {JSON.stringify(request.tuple, null, 2)}
        </pre>
      </TechnicalDetails>
    </>
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
          <dt>运营记录人 / 时间</dt>
          <dd>
            {approval.recordedBy} / {approval.recordedAt}
          </dd>
        </div>
      </dl>
      <TechnicalDetails label="已登记依据的技术版本">
        <dl className={styles.facts}>
          <div>
            <dt>固定基线身份</dt>
            <dd>
              {review.binding.baseline.id} / {review.binding.baseline.version}
              <br />
              {review.binding.baseline.entrySha256}
            </dd>
          </div>
        </dl>
      </TechnicalDetails>
      <TechnicalDetails label="审核依据技术标识">
        <dl className={styles.facts}>
          <div>
            <dt>证据 SHA-256</dt>
            <dd>{review.facts.approval.evidenceSha256}</dd>
          </div>
          <div>
            <dt>审核依据记录 ID / 事实 SHA-256</dt>
            <dd>
              {review.id}
              <br />
              {review.reviewSha256}
            </dd>
          </div>
        </dl>
      </TechnicalDetails>
    </div>
  );
}
export type VersionReceiptActions = {
  onOpenVersion: (versionId: string) => void;
  onGoToTesting?: (() => void) | undefined;
};
export function VersionReceiptFacts({
  version,
  actions,
}: {
  version: InternalVersionReceipt;
  actions?: VersionReceiptActions | undefined;
}) {
  if (actions)
    return (
      <section className={local.receipt} data-internal-version={version.id}>
        <h3>内测内容版本 #{version.slot} 已固定</h3>
        <p>
          来源修订 r{version.binding.target.revision} · 内容不随后续草稿改变。
        </p>
        <p>可继续创建答题版本；未授予对外发布批准。</p>
        <p>固定于 {directoryTime(version.createdAt)}</p>
        <TechnicalDetails label="固定版本技术标识">
          <p>{version.id}</p>
          <p>{version.snapshotSha256}</p>
        </TechnicalDetails>
        <div className={styles.actions}>
          <button
            className={`${styles.button} ${styles.secondary}`}
            onClick={() => actions.onOpenVersion(version.id)}
          >
            阅读固定内测内容版本
          </button>
          <button
            className={styles.button}
            disabled={!actions.onGoToTesting}
            onClick={actions.onGoToTesting}
          >
            创建答题版本与发码
          </button>
        </div>
      </section>
    );
  return (
    <div className={local.receipt} data-internal-version={version.id}>
      <h3>固定内测内容版本 · 槽位 {version.slot}</h3>
      <p>{INTERNAL_VERSION_DISCLOSURE}</p>
      <p>对外发布批准：未授予</p>
      <p>
        下一步：可基于此固定版本创建消费者答题版本；创建与发放访问码
        仍需明确操作。
      </p>
      <dl className={styles.facts}>
        <div>
          <dt>版本 ID</dt>
          <dd>{version.id}</dd>
        </div>

        <div>
          <dt>封存操作人 / 时间</dt>
          <dd>
            {version.createdBy} / {version.createdAt}
          </dd>
        </div>
      </dl>
      <TechnicalDetails label="内容版本技术摘要">
        <dl className={styles.facts}>
          <div>
            <dt>快照 SHA-256</dt>
            <dd>{version.snapshotSha256}</dd>
          </div>
        </dl>
      </TechnicalDetails>
      <Link
        className={styles.link}
        href={internalVersionPageUrl(version.binding.productId, version.id)}
      >
        阅读固定内测内容版本
      </Link>
      <Link
        className={styles.link}
        href={`/studio/products/${encodeURIComponent(version.binding.productId)}?task=testing`}
      >
        创建答题版本与发码
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
    <article className={local.versionCard}>
      <h3>
        槽位 {version.slot} · 来源修订 {version.target.revision}
      </h3>
      <p>{versionRevisionRelation(version.target.revision, currentRevision)}</p>
      <TechnicalDetails label="快照与实现技术信息">
        <p>版本编号：{version.id}</p>
        <p>固定快照：{version.snapshotSha256}</p>
        <p>
          渲染器：{version.renderer.id} / {version.renderer.version}；能力：仅
          Studio 内部预览
        </p>
        <p>
          评分引擎：{version.engine.id} / {version.engine.version}
        </p>
      </TechnicalDetails>
      <p className={local.hint}>
        封存于{" "}
        <time dateTime={version.createdAt}>
          {directoryTime(version.createdAt)}
        </time>{" "}
        · 未授予对外发布批准
      </p>
      <div className={local.versionActions}>
        <Link
          className={local.readButton}
          aria-label="阅读固定内测内容版本"
          href={internalVersionPageUrl(version.productId, version.id)}
        >
          查看固定版本 →
        </Link>
        <Link
          className={local.textLink}
          aria-label="阅读来源修订审核依据记录"
          href={internalReviewPageUrl({
            productId: version.productId,
            draftId: version.target.draftId,
            revision: version.target.revision,
          })}
        >
          查看来源审核 →
        </Link>
      </div>
    </article>
  );
}
