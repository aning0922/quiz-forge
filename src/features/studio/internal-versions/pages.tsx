"use client";
import Link from "next/link";
import { useState } from "react";
import type { StudioSessionDto } from "../contracts";
import { WorkspaceNav } from "../workspace/primitives";
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
  draftWorkspacePath,
} from "../drafts/client";
import { previewPagePath } from "@/features/product/preview/urls";
import styles from "../workspace/workspace.module.css";
import local from "./internal-versions.module.css";
function InternalNav({ productId }: { productId: string }) {
  return (
    <div className={styles.actions}>
      <Link
        className={`${styles.link} ${styles.secondary}`}
        href={`/studio/products/${productId}`}
      >
        返回工作区
      </Link>
      <Link
        className={`${styles.link} ${styles.secondary}`}
        href={draftWorkspacePath(productId)}
      >
        服务器草稿与修订历史
      </Link>
      <Link className={styles.link} href={internalVersionsPageUrl(productId)}>
        固定内测版本与原请求核实
      </Link>
    </div>
  );
}
/** Mounted by Product identity even if its mutable detail GET fails. */
export function StableInternalWorkspace({
  productId,
  session,
}: {
  productId: string;
  session: StudioSessionDto;
}) {
  const parsed =
    internalRevisionScopeSchema.shape.productId.safeParse(productId);
  if (!parsed.success) return null;
  return (
    <>
      <section className={styles.panel} aria-label="稳定工作区内测入口">
        <h2>固定内测版本与恢复</h2>
        <p>{INTERNAL_VERSION_DISCLOSURE}</p>
        <Link
          className={styles.link}
          href={internalVersionsPageUrl(parsed.data)}
        >
          固定内测版本与原请求核实
        </Link>
      </section>
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
      <WorkspaceNav />
      <InternalNav productId={scope.productId} />
      <section className={styles.panel}>
        <h1>固定修订 {scope.revision} · 既有内测基线</h1>
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
            体验此固定修订内部预览
          </Link>
        </div>
        {read.loading && <p role="status">正在核对修订与基线记录…</p>}
        {read.error && (
          <p className={styles.error} role="alert">
            {read.error}
          </p>
        )}
        {read.value && (
          <>
            <p>
              本次读取的当前 head：{read.value.observedCurrentRevision}
              ；此页固定目标：{read.value.target.revision}。
            </p>
            <TargetFacts target={read.value.target} />
            {read.value.review ? (
              <ReviewFacts review={read.value.review} />
            ) : (
              <p>此目标尚无基线记录。服务器登记候选不等同于已经记录。</p>
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
      <WorkspaceNav />
      <InternalNav productId={productId} />
      <section className={styles.panel}>
        <h1>固定内测版本</h1>
        <p>{INTERNAL_VERSION_DISCLOSURE}</p>
        <p>
          列表保存固定身份元数据。历史版本不会因当前
          head、资源或实现可用性变化而改用最新身份；详情与预览仍需分别核验。
        </p>
        <div className={styles.actions}>
          <button
            className={styles.button}
            disabled={list.loading}
            onClick={list.refresh}
          >
            重新读取固定版本列表
          </button>
          <button
            className={`${styles.button} ${styles.secondary}`}
            disabled={draft.loading}
            onClick={draft.refresh}
          >
            读取当前草稿指针
          </button>
          {current && (
            <Link className={styles.link} href={internalReviewPageUrl(current)}>
              当前修订 {current.revision} 的基线与封存
            </Link>
          )}
        </div>
        {draft.loading && <p role="status">正在读取当前草稿指针…</p>}
        {draft.error && (
          <p role="alert">
            当前 head 未可靠读取：{draft.error}。原请求核实仍可使用。
          </p>
        )}
        {draft.value?.kind === "empty" && (
          <p>本次读取没有当前草稿；这不能证明旧请求未执行。</p>
        )}
        {list.loading && <p role="status">正在读取固定版本元数据…</p>}
        {list.error && (
          <p className={styles.error} role="alert">
            {list.error}
          </p>
        )}
        {list.value && (
          <>
            <p>
              已占用固定槽位：{list.value.versions.length} / 100；不可删除。
            </p>
            {!list.value.versions.length && (
              <p>本次列表没有固定版本。空列表不能作为解除原请求锚点的证据。</p>
            )}
            <div className={styles.cards}>
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
      <WorkspaceNav />
      <InternalNav productId={productId} />
      <section className={styles.panel}>
        <h1>固定内测版本 · 只读快照</h1>
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
            {read.error} 原请求核实区仍保留。
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
              以下为已核对摘要的固定快照；渲染能力仅为 Studio
              内部预览，不表示已实现消费者版本入口。
            </p>
            <details className={local.details}>
              <summary>完整固定快照</summary>
              <pre className={local.code}>
                {JSON.stringify(read.value.snapshot, null, 2)}
              </pre>
            </details>
          </>
        )}
        {draft.error && (
          <p role="alert">当前 head 尚未可靠读取；固定快照没有被替换。</p>
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
