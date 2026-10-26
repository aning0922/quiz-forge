"use client";
import { useOwnedStudioSession } from "../accounts/session-owner";
import { TechnicalDetails } from "../presentation/technical-details";
import { StudioPageHeader } from "../presentation/page-header";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { AppendDraftApplication } from "@/features/product/draft-revisions/contracts";
import { RevisionHistoryPanel } from "../draft-revisions/history";
import { RevisionPendingPanel } from "../draft-revisions/pending-panel";
import { RevisionLinks } from "../draft-revisions/primitives";
import type { StudioSessionDto } from "../contracts";
import { DraftPendingPanel } from "./pending-panel";
import {
  checkDraftRead,
  checkDraftRevision,
  draftEndpoint,
  draftRevisionEndpoint,
  draftWorkspacePath,
} from "./client";
import { useDraftRead } from "./use-read";
import { DraftFacts } from "./facts";
import { FixedContentInspector } from "./content-inspector";
import styles from "../workspace/workspace.module.css";
import draftStyles from "./drafts.module.css";
export function DraftWorkspacePage({
  productId,
  session: initialSession,
}: {
  productId: string;
  session: StudioSessionDto;
}) {
  const session = useOwnedStudioSession(initialSession);
  const [application, setApplication] = useState<AppendDraftApplication>();
  const read = useDraftRead(draftEndpoint(productId), (value) =>
    checkDraftRead(value, productId),
  );
  return (
    <div className={styles.workspace}>
      <section className={styles.panel}>
        <StudioPageHeader
          title="内容草稿"
          description="先核对当前草稿，再选择固定修订阅读、预览或记录内测基线。历史处理结果与当前指针分别保留。"
        />
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
            读取当前草稿
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
            服务器当前没有草稿。空查询不能证明先前应用请求未执行；请到原验证详情核对待确认处理结果。
          </p>
        )}
        {read.value?.kind === "draft" && (
          <DraftFacts draft={read.value.draft} />
        )}
      </section>
      {application && (
        <section className={styles.panel} aria-label="已核实的固定追加处理结果">
          <h2>已核实的固定追加处理结果：修订 {application.revision}</h2>
          <p>此处理结果独立于当前草稿摘要。</p>
          <RevisionLinks draft={application} />
        </section>
      )}
      <DraftPendingPanel
        key={productId}
        productId={productId}
        session={session}
        refreshing={read.loading}
        onConfirmed={read.refresh}
      />
      <RevisionPendingPanel
        key={`append/${productId}`}
        productId={productId}
        session={session}
        refreshing={read.loading}
        onChanged={(value) => {
          if (value) setApplication(value);
          read.refresh();
        }}
      />
      {read.lastValue?.kind === "draft" && (
        <RevisionHistoryPanel
          key={`${productId}/${read.lastValue.draft.draftId}`}
          productId={productId}
          draftId={read.lastValue.draft.draftId}
          currentRevision={read.lastValue.draft.revision}
        />
      )}
    </div>
  );
}
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
