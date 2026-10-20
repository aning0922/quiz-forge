"use client";
import Link from "next/link";
import { WorkspaceNav } from "../workspace/primitives";
import { checkValidation, validationEndpoint } from "./client";
import { ValidationFacts } from "./facts";
import { useValidationRead } from "./use-read";
import styles from "../workspace/workspace.module.css";
/** This page is strictly read-only. Explicit operations live beside import facts/history. */
export function ValidationDetailPage({
  productId,
  importId,
  validationId,
}: {
  productId: string;
  importId: string;
  validationId: string;
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
          此页只读取当前权威摘要，不执行恢复、重试、发布或草稿编辑。
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
    </div>
  );
}
