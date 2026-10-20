"use client";
import Link from "next/link";
import type { StudioSessionDto } from "../contracts";
import { DraftPendingPanel } from "./pending-panel";
import { WorkspaceNav } from "../workspace/primitives";
import {
  checkDraftRead,
  checkDraftRevision,
  draftEndpoint,
  draftRevisionEndpoint,
  draftWorkspacePath,
} from "./client";
import { useDraftRead } from "./use-read";
import { DraftFacts } from "./facts";
import styles from "../workspace/workspace.module.css";
import draftStyles from "./drafts.module.css";
export function DraftWorkspacePage({
  productId,
  session,
}: {
  productId: string;
  session: StudioSessionDto;
}) {
  const read = useDraftRead(draftEndpoint(productId), (value) =>
    checkDraftRead(value, productId),
  );
  return (
    <div className={styles.workspace}>
      <WorkspaceNav />
      <section className={styles.panel}>
        <h1>工作区草稿</h1>
        <div className={styles.actions}>
          <Link
            className={styles.link}
            href={`/studio/products/${encodeURIComponent(productId)}`}
          >
            返回工作区
          </Link>
          <button
            className={styles.button}
            disabled={read.loading}
            onClick={read.refresh}
          >
            读取服务器草稿
          </button>
        </div>
        {read.loading && <p role="status">正在读取草稿…</p>}
        {read.error && (
          <p role="alert" className={styles.error}>
            {read.error}
          </p>
        )}
        {read.value?.kind === "empty" && (
          <p>
            服务器当前没有草稿。空查询不能证明先前应用请求未执行；请到原验证详情核对待确认回执。
          </p>
        )}
        {read.value?.kind === "draft" && (
          <DraftFacts draft={read.value.draft} />
        )}
      </section>
      <DraftPendingPanel
        key={productId}
        productId={productId}
        session={session}
        refreshing={read.loading}
        onConfirmed={read.refresh}
      />
    </div>
  );
}
export function DraftRevisionPage({
  productId,
  draftId,
  revision,
}: {
  productId: string;
  draftId: string;
  revision: number;
}) {
  const read = useDraftRead(
    draftRevisionEndpoint(productId, draftId, revision),
    (value) => checkDraftRevision(value, { productId, draftId, revision }),
    true,
  );
  return (
    <div className={styles.workspace}>
      <WorkspaceNav />
      <section className={styles.panel}>
        <h1>草稿固定修订 · 只读</h1>
        <div className={styles.actions}>
          <Link className={styles.link} href={draftWorkspacePath(productId)}>
            返回服务器草稿
          </Link>
          <button
            className={styles.button}
            disabled={read.loading}
            onClick={read.refresh}
          >
            重新读取固定修订
          </button>
        </div>
        {read.loading && <p role="status">正在读取并核对完整正文摘要…</p>}
        {read.error && (
          <p role="alert" className={styles.error}>
            {read.error}
          </p>
        )}
        {read.value && (
          <>
            <DraftFacts draft={read.value.draft} />
            <label className={draftStyles.body}>
              完整内容正文
              <textarea
                aria-label="完整内容正文"
                readOnly
                value={read.value.canonicalContentText}
              />
            </label>
            <label className={draftStyles.body}>
              完整素材集合正文
              <textarea
                aria-label="完整素材集合正文"
                readOnly
                value={read.value.assetSetText}
              />
            </label>
          </>
        )}
      </section>
    </div>
  );
}
