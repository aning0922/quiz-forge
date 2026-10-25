"use client";
import { TechnicalDetails } from "../presentation/technical-details";
import { StudioPageHeader } from "../presentation/page-header";
import { StudioWorkflowNav } from "../presentation/workflow-nav";
import Link from "next/link";
import { useState } from "react";
import type { StudioSessionDto } from "../contracts";
import {
  internalReviewUrl,
  internalVersionsUrl,
  internalVersionUrl,
  internalRevisionScopeSchema,
  type InternalRevisionScope,
} from "@/features/product/internal-versions/urls";
import {
  readInternalReviewState,
  readInternalVersions,
  readInternalVersion,
} from "./client";
import { internalVersionsPageUrl, internalReviewPageUrl } from "./paths";
import { useInternalRead } from "./use-read";
import { InternalRecoveryPanels } from "./pending-panel";
import { InternalWritePanel } from "./write-panel";
import {
  TargetFacts,
  ReviewFacts,
  VersionMetadataFacts,
  VersionReceiptFacts,
} from "./facts";
import {
  INTERNAL_VERSION_DISCLOSURE,
  versionRevisionRelation,
} from "./view-state";
import { InternalAuthorityProvider } from "./authority";
import {
  draftEndpoint,
  checkDraftRead,
  checkedDraftFetch,
} from "../drafts/client";
import { previewPagePath } from "@/features/product/preview/urls";
import styles from "../workspace/workspace.module.css";
import local from "./internal-versions.module.css";
/** Mounted by Product identity even if its mutable detail GET fails. */
export function StableInternalWorkspace({
  productId,
  session,
  showEntry = true,
}: {
  productId: string;
  session: StudioSessionDto;
  showEntry?: boolean;
}) {
  const parsed =
    internalRevisionScopeSchema.shape.productId.safeParse(productId);
  if (!parsed.success) return null;
  return (
    <>
      {showEntry && (
        <section className={styles.panel} aria-label="稳定工作区内测入口">
          <h2>审核依据与内容版本</h2>
          <p>
            记录已有的内容与素材审核依据，再固定本次内测内容；不代表新增批准或对外发布。
          </p>
          <Link
            className={styles.link}
            href={internalVersionsPageUrl(parsed.data)}
          >
            查看审核依据与内容版本
          </Link>
        </section>
      )}
      <InternalRecoveryPanels
        key={parsed.data}
        productId={parsed.data}
        session={session}
      />
    </>
  );
}
function InternalReviewContent({
  scope,
  session,
}: {
  scope: InternalRevisionScope;
  session: StudioSessionDto;
}) {
  const [nonce, setNonce] = useState(0),
    read = useInternalRead(internalReviewUrl(scope), (signal) =>
      readInternalReviewState(scope, signal),
    ),
    list = useInternalRead(internalVersionsUrl(scope.productId), (signal) =>
      readInternalVersions(scope.productId, signal),
    );
  function changed() {
    setNonce((n) => n + 1);
    read.refresh();
    list.refresh();
  }
  return (
    <div className={styles.workspace}>
      <StudioWorkflowNav
        productId={scope.productId}
        current="versions"
        previewHref={previewPagePath(scope)}
      />
      <section className={styles.panel}>
        <StudioPageHeader
          title={`固定修订 ${scope.revision} · 已有审核依据`}
          description="核对固定修订与既有批准证据，再明确记录或封存。候选登记不等于基线已记录。"
        />
        <p>{INTERNAL_VERSION_DISCLOSURE}</p>
        <div className={styles.actions}>
          <button
            className={styles.button}
            disabled={read.loading || list.loading}
            onClick={() => {
              read.refresh();
              list.refresh();
            }}
          >
            重新读取修订事实与封存容量
          </button>
          <Link
            className={`${styles.link} ${styles.secondary}`}
            href={previewPagePath(scope)}
          >
            体验此固定修订内容预览
          </Link>
        </div>
        {read.loading && <p role="status">正在核对修订与审核依据记录…</p>}
        {read.error && (
          <p className={styles.error} role="alert">
            {read.error}
          </p>
        )}
        {read.value && (
          <>
            <p>
              本次读取的当前修订：{read.value.observedCurrentRevision}
              ；此页固定目标：{read.value.target.revision}。
            </p>
            <TargetFacts target={read.value.target} />
            {read.value.review ? (
              <ReviewFacts review={read.value.review} />
            ) : (
              <p>此目标尚无审核依据记录。服务器登记候选不等同于已经记录。</p>
            )}
          </>
        )}
        {list.error && (
          <p className={styles.error} role="alert">
            封存容量读取未完成：{list.error}
          </p>
        )}
        {list.value && (
          <p>
            已占用固定槽位：{list.value.versions.length} / 100；版本不可删除。
          </p>
        )}
      </section>
      <InternalWritePanel
        key={scope.productId}
        productId={scope.productId}
        state={read.value}
        versions={list.value}
        session={session}
        nonce={nonce}
        onChanged={changed}
      />
      <InternalRecoveryPanels
        productId={scope.productId}
        session={session}
        nonce={nonce}
        onChanged={changed}
      />
    </div>
  );
}
function InternalVersionsContent({
  productId,
  session,
}: {
  productId: string;
  session: StudioSessionDto;
}) {
  const [nonce, setNonce] = useState(0),
    list = useInternalRead(internalVersionsUrl(productId), (signal) =>
      readInternalVersions(productId, signal),
    ),
    draft = useInternalRead(draftEndpoint(productId), (signal) =>
      checkedDraftFetch(draftEndpoint(productId), { signal }, (value) =>
        checkDraftRead(value, productId),
      ),
    );
  const current = draft.value?.kind === "draft" ? draft.value.draft : undefined;
  function changed() {
    setNonce((n) => n + 1);
    list.refresh();
    draft.refresh();
  }
  return (
    <div className={styles.workspace}>
      <StudioWorkflowNav
        productId={productId}
        current="versions"
        {...(current ? { previewHref: previewPagePath(current) } : {})}
      />
      <StudioPageHeader
        title="审核与版本"
        description="核对当前修订的内容、既有依据与封存条件；已有固定版本分别保留。"
      />
      <div className={local.versionColumns}>
        <section className={local.currentPanel} aria-label="当前修订核对">
          <div className={local.sectionHeading}>
            <h2>当前修订核对</h2>
            {current && (
              <span className={local.currentLabel}>
                当前草稿 r{current.revision}
              </span>
            )}
          </div>
          <p className={local.hint}>
            审核依据来自已有准确证据，记录与封存仍需在固定修订页面明确操作。
          </p>
          <ol className={local.reviewSteps}>
            <li>
              <span aria-hidden="true">1</span>
              <div>
                <h3>核对当前草稿内容与素材</h3>
                <p>
                  查看指定修订的题目、评分与预览；预览入口不表示已经人工体验。
                </p>
              </div>
            </li>
            <li>
              <span aria-hidden="true">2</span>
              <div>
                <h3>核对已有审核依据</h3>
                <p>
                  在固定修订页面逐项核对批准证据与完整目标，不沿用其他修订的审核资格。
                </p>
              </div>
            </li>
            <li>
              <span aria-hidden="true">3</span>
              <div>
                <h3>封存不可变内测内容版本</h3>
                <p>
                  满足原服务条件后明确封存，历史版本和用户报告不会被新草稿覆盖。
                </p>
              </div>
            </li>
          </ol>
          {draft.loading && <p role="status">正在读取当前草稿指针…</p>}
          {draft.error && (
            <p className={styles.error} role="alert">
              当前修订 未可靠读取：{draft.error}。原操作核实仍可使用。
            </p>
          )}
          {draft.value?.kind === "empty" && (
            <p className={local.empty}>
              本次读取没有当前草稿；这不能证明旧请求未执行。
            </p>
          )}
          {current && (
            <div className={local.currentActions}>
              <Link
                className={styles.link}
                href={internalReviewPageUrl({
                  productId: current.productId,
                  draftId: current.draftId,
                  revision: current.revision,
                })}
              >
                当前修订 {current.revision} 的基线与封存
              </Link>
              <Link className={local.textLink} href={previewPagePath(current)}>
                体验此固定修订内容预览 →
              </Link>
            </div>
          )}
          <button
            className={local.readButton}
            disabled={draft.loading}
            onClick={draft.refresh}
          >
            读取当前草稿指针
          </button>
          <p className={local.hint}>{INTERNAL_VERSION_DISCLOSURE}</p>
        </section>
        <section className={local.historyPanel} aria-label="已有固定版本">
          <div className={local.sectionHeading}>
            <h2>已有固定版本</h2>
            <button
              className={local.readButton}
              disabled={list.loading}
              onClick={list.refresh}
            >
              重新读取固定版本列表
            </button>
          </div>
          <p className={local.hint}>
            按服务器固定槽位倒序排列；来源修订与当前草稿分别标示，旧版本不会自动更新。
          </p>
          {list.loading && <p role="status">正在读取固定版本元数据…</p>}
          {list.error && (
            <p className={styles.error} role="alert">
              {list.error}
            </p>
          )}
          {list.value && (
            <>
              <p className={local.capacity}>
                已占用固定槽位：{list.value.versions.length} / 100；不可删除。
              </p>
              {!list.value.versions.length && (
                <p className={local.empty}>
                  本次列表没有固定版本。空列表不能作为解除原操作记录的证据。
                </p>
              )}
              <div className={local.versionList}>
                {list.value.versions.map((version) => (
                  <VersionMetadataFacts
                    key={version.id}
                    version={version}
                    currentRevision={current?.revision}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      </div>
      <InternalRecoveryPanels
        productId={productId}
        session={session}
        nonce={nonce}
        onChanged={changed}
      />
    </div>
  );
}
function InternalVersionDetailContent({
  productId,
  versionId,
  session,
}: {
  productId: string;
  versionId: string;
  session: StudioSessionDto;
}) {
  const [nonce, setNonce] = useState(0),
    read = useInternalRead(internalVersionUrl(productId, versionId), (signal) =>
      readInternalVersion(productId, versionId, signal),
    ),
    draft = useInternalRead(draftEndpoint(productId), (signal) =>
      checkedDraftFetch(draftEndpoint(productId), { signal }, (value) =>
        checkDraftRead(value, productId),
      ),
    );
  const current = draft.value?.kind === "draft" ? draft.value.draft : undefined;
  return (
    <div className={styles.workspace}>
      <StudioWorkflowNav
        productId={productId}
        current="versions"
        {...(read.value
          ? {
              previewHref: previewPagePath({
                productId,
                draftId: read.value.snapshot.target.draftId,
                revision: read.value.snapshot.target.revision,
              }),
            }
          : {})}
      />
      <section className={styles.panel}>
        <StudioPageHeader
          title="固定内容版本详情"
          description="此页核对已封存的固定快照，不会替换为当前草稿。"
        />
        <p>{INTERNAL_VERSION_DISCLOSURE}</p>
        <button
          className={styles.button}
          disabled={read.loading}
          onClick={read.refresh}
        >
          重新读取并核对完整快照
        </button>
        {read.loading && <p role="status">正在读取固定快照并核对 SHA-256…</p>}
        {read.error && (
          <p className={styles.error} role="alert">
            {read.error} 原操作核实区仍保留。
          </p>
        )}
        {read.value && (
          <>
            <VersionReceiptFacts version={read.value.version} />
            <p>
              {versionRevisionRelation(
                read.value.snapshot.target.revision,
                current?.revision,
              )}
            </p>
            <TargetFacts target={read.value.snapshot.target} />
            <p>
              此处查看已固定的内容版本。若要让用户答题，请另到“答题版本与访问码”创建答题版本。
            </p>
            <TechnicalDetails label="完整固定快照">
              <pre className={local.code}>
                {JSON.stringify(read.value.snapshot, null, 2)}
              </pre>
            </TechnicalDetails>
          </>
        )}
        {draft.error && (
          <p role="alert">当前修订 尚未可靠读取；固定快照没有被替换。</p>
        )}
      </section>
      <InternalRecoveryPanels
        productId={productId}
        session={session}
        nonce={nonce}
        onChanged={() => {
          setNonce((n) => n + 1);
          read.refresh();
        }}
      />
    </div>
  );
}

export function InternalReviewPage(
  props: Parameters<typeof InternalReviewContent>[0],
) {
  return (
    <InternalAuthorityProvider
      key={props.scope.productId}
      productId={props.scope.productId}
    >
      <InternalReviewContent {...props} />
    </InternalAuthorityProvider>
  );
}
export function InternalVersionsPage(
  props: Parameters<typeof InternalVersionsContent>[0],
) {
  return (
    <InternalAuthorityProvider
      key={props.productId}
      productId={props.productId}
    >
      <InternalVersionsContent {...props} />
    </InternalAuthorityProvider>
  );
}
export function InternalVersionDetailPage(
  props: Parameters<typeof InternalVersionDetailContent>[0],
) {
  return (
    <InternalAuthorityProvider
      key={props.productId}
      productId={props.productId}
    >
      <InternalVersionDetailContent {...props} />
    </InternalAuthorityProvider>
  );
}
