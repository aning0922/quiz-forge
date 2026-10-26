"use client";
import { TechnicalDetails } from "../presentation/technical-details";
import { StudioPageHeader } from "../presentation/page-header";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  checkDraftRevision,
  draftRevisionEndpoint,
  draftWorkspacePath,
} from "./client";
import { useDraftRead } from "./use-read";
import { DraftFacts } from "./facts";
import { FixedContentInspector } from "./content-inspector";
import styles from "../workspace/workspace.module.css";
import draftStyles from "./drafts.module.css";
export function DraftRevisionPage({
  productId,
  draftId,
  revision,
  navigation,
}: {
  productId: string;
  draftId: string;
  revision: number;
  navigation: ReactNode;
}) {
  const read = useDraftRead(
    draftRevisionEndpoint(productId, draftId, revision),
    (value) => checkDraftRevision(value, { productId, draftId, revision }),
    true,
  );
  return (
    <div className={styles.workspace}>
      <section className={styles.panel}>
        <StudioPageHeader
          title="草稿历史修订 · 只读"
          description={
            <>
              固定目标：修订 {revision}
              。正文核验成功后可进入此修订预览或既有审核依据记录。
            </>
          }
        />
        <div className={styles.actions}>
          <Link className={styles.link} href={draftWorkspacePath(productId)}>
            返回当前草稿
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
            <div className={styles.actions}>{navigation}</div>
            <FixedContentInspector
              productId={productId}
              canonicalContentText={read.value.canonicalContentText}
            />
            <TechnicalDetails label="固定修订完整正文与素材集合">
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
            </TechnicalDetails>
          </>
        )}
      </section>
    </div>
  );
}
