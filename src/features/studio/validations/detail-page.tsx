"use client";
import { useOwnedStudioSession } from "../accounts/session-owner";
import { StudioPageHeader } from "../presentation/page-header";
import Link from "next/link";
import type { StudioSessionDto } from "../contracts";
import { ApplyDraftPanel } from "../drafts/apply-panel";
import { AppendRevisionPanel } from "../draft-revisions/append-panel";
import { checkValidation, validationEndpoint } from "./client";
import { ValidationFacts } from "./facts";
import { useValidationRead } from "./use-read";
import styles from "../workspace/workspace.module.css";
export function ValidationDetailPage({
  productId,
  importId,
  validationId,
  session: initialSession,
}: {
  productId: string;
  importId: string;
  validationId: string;
  session: StudioSessionDto;
}) {
  const session = useOwnedStudioSession(initialSession);
  const record = useValidationRead(
    `${validationEndpoint({ productId, importId })}/${encodeURIComponent(validationId)}`,
    (value) => checkValidation(value, { productId, importId, validationId }),
  );
  return (
    <div className={styles.workspace}>
      <section className={styles.panel}>
        <StudioPageHeader
          title="内容检查结果"
          description="核对归档结论后，明确选择首次草稿或追加修订。待确认原操作在下方独立保留。"
        />
        <Link
          className={`${styles.link} ${styles.secondary}`}
          href={`/studio/products/${encodeURIComponent(productId)}/imports/${encodeURIComponent(importId)}`}
        >
          返回接收与检查记录
        </Link>
        <p className={styles.note}>
          此页读取当前权威摘要；符合条件的归档可明确用于首次草稿，或追加到现有草稿。
        </p>
        <button
          className={styles.button}
          disabled={record.loading}
          onClick={record.refresh}
        >
          查询最新检查结果
        </button>
        {record.loading && (
          <p className={styles.status} role="status">
            正在读取服务器验证状态…
          </p>
        )}
        {record.error && (
          <p className={`${styles.status} ${styles.error}`} role="alert">
            {record.error}
          </p>
        )}
        {record.value && <ValidationFacts value={record.value} />}
      </section>
      {record.value && (
        <ApplyDraftPanel
          key={`${record.value.id}/${record.value.stateRevision}/${record.value.candidateSha256}`}
          validation={record.value}
          session={session}
          refreshing={record.loading || Boolean(record.error)}
        />
      )}
      <AppendRevisionPanel
        key={`append/${productId}`}
        productId={productId}
        validation={record.value}
        session={session}
        refreshing={record.loading}
      />
    </div>
  );
}
