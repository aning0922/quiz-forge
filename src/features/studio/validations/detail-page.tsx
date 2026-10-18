"use client";
import Link from "next/link";
import type { StudioSessionDto } from "../contracts";
import { ApplyDraftPanel } from "../drafts/apply-panel";
import { AppendRevisionPanel } from "../draft-revisions/append-panel";
import { WorkspaceNav } from "../workspace/primitives";
import { checkValidation, validationEndpoint } from "./client";
import { ValidationFacts } from "./facts";
import { useValidationRead } from "./use-read";
import styles from "../workspace/workspace.module.css";
export function ValidationDetailPage({
  productId,
  importId,
  validationId,
  session,
}: {
  productId: string;
  importId: string;
  validationId: string;
  session: StudioSessionDto;
}) {
  const record = useValidationRead(
    `${validationEndpoint({ productId, importId })}/${encodeURIComponent(validationId)}`,
    (value) => checkValidation(value, { productId, importId, validationId }),
  );
  return (
    <div className={styles.workspace}>
      <WorkspaceNav />
      <section className={styles.panel}>
        <h1>验证归档详情</h1>
        <Link
          className={`${styles.link} ${styles.secondary}`}
          href={`/studio/products/${encodeURIComponent(productId)}/imports/${encodeURIComponent(importId)}`}
        >
          返回接收事实与验证历史
        </Link>
        <p className={styles.note}>
          此页读取当前权威摘要；符合条件的归档可明确用于首次草稿，或追加到现有草稿。
        </p>
        <button
          className={styles.button}
          disabled={record.loading}
          onClick={record.refresh}
        >
          读取最新验证详情
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
      {record.value && (
        <AppendRevisionPanel
          key={`append/${record.value.id}/${record.value.stateRevision}/${record.value.candidateSha256}`}
          validation={record.value}
          session={session}
          refreshing={record.loading || Boolean(record.error)}
        />
      )}
    </div>
  );
}
