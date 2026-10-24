"use client";

import { useMemo } from "react";
import type { RevisionTarget } from "@/features/product/internal-versions/identity-contracts";
import { sameRevisionTarget } from "@/features/product/internal-versions/identity-contracts";
import { checkDraftRevision, draftRevisionEndpoint } from "../drafts/client";
import { useDraftRead } from "../drafts/use-read";
import { FixedContentInspector } from "../drafts/content-inspector";
import { useInternalAuthority } from "../internal-versions/authority";
import { invalidateCurrentStudioAuthority } from "../authority-events";
import { TechnicalDetails } from "../presentation/technical-details";
import { directoryTime } from "../workspace/directory-time";
import { ContentAuthorityContext } from "./content-authority";
import { RetainedTaskActions } from "./task-surfaces";
import styles from "./revision-details.module.css";

type Props = {
  productId: string;
  target: RevisionTarget;
  onPreview: (target: RevisionTarget) => void;
  onInspectSource: (sourceId: string) => void;
};

export function RevisionDetails(props: Props) {
  const authority = useInternalAuthority();
  const scope = useMemo(
    () => ({
      canWrite: () => !authority.isRevoked,
      observe: (error: unknown) => {
        const wasRevoked = authority.isRevoked;
        authority.observe(error);
        if (!wasRevoked && authority.isRevoked)
          invalidateCurrentStudioAuthority();
      },
    }),
    [authority],
  );
  return (
    <ContentAuthorityContext.Provider value={scope}>
      <Details {...props} />
    </ContentAuthorityContext.Provider>
  );
}

function Details({ productId, target, onPreview, onInspectSource }: Props) {
  const authority = useInternalAuthority();
  const read = useDraftRead(
    draftRevisionEndpoint(productId, target.draftId, target.revision),
    (value) =>
      checkDraftRevision(value, {
        productId,
        draftId: target.draftId,
        revision: target.revision,
      }),
    true,
  );
  const draft = read.value?.draft;
  const matches =
    draft &&
    sameRevisionTarget(target, {
      draftId: draft.draftId,
      revision: draft.revision,
      canonicalContentSha256: draft.canonicalContentSha256,
      assetSetSha256: draft.assetSetSha256,
      canonicalManifestSha256: draft.canonicalManifestSha256,
    });
  return (
    <div className={styles.details}>
      <section className={styles.summary}>
        <span className={styles.badge}>固定内容 · r{target.revision}</span>
        <p>此修订独立保存，不随当前草稿变化。</p>
        {draft && matches && (
          <dl>
            <dt>内容包版本</dt>
            <dd>{draft.packVersion}</dd>
            <dt>形成时间</dt>
            <dd>{directoryTime(draft.createdAt)}</dd>
            <dt>内容类型</dt>
            <dd>
              {draft.contentKind === "authored" ? "作者内容" : "合成测试内容"}
            </dd>
          </dl>
        )}
      </section>
      {read.loading && <p role="status">正在读取并核对固定内容…</p>}
      {read.error && <p role="alert">{read.error}</p>}
      {draft && !matches && (
        <p role="alert">读取结果与所选修订身份不一致，尚不能使用此内容。</p>
      )}
      {read.value && matches && (
        <>
          <FixedContentInspector
            productId={productId}
            canonicalContentText={read.value.canonicalContentText}
          />
          <button
            type="button"
            onClick={() => onInspectSource(read.value!.draft.sourceImportId)}
          >
            查看此修订的来源与检查
          </button>
          <TechnicalDetails label="完整内容与校验信息">
            <p>草稿编号：{target.draftId}</p>
            <p>内容摘要：{target.canonicalContentSha256}</p>
            <textarea
              aria-label="固定修订完整正文"
              readOnly
              value={read.value.canonicalContentText}
              rows={8}
            />
          </TechnicalDetails>
        </>
      )}
      <button
        type="button"
        disabled={read.loading || authority.isRevoked}
        onClick={read.refresh}
      >
        重新读取此修订
      </button>
      <RetainedTaskActions id="revision">
        <button
          className={styles.primary}
          type="button"
          disabled={!matches || authority.isRevoked}
          onClick={() => onPreview(target)}
        >
          预览此修订
        </button>
      </RetainedTaskActions>
    </div>
  );
}
