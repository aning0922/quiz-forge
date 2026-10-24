"use client";

import { useInternalAuthority } from "../internal-versions/authority";
import { useProductOperations } from "./read";
import { OperationsSummary } from "./summary";
import styles from "../workspace/workspace.module.css";

/** Refresh stays inside this sibling; editors and pending-operation owners stay mounted. */
export function ProductOperationsSummary({ productId }: { productId: string }) {
  const authority = useInternalAuthority();
  const read = useProductOperations(productId, (error) =>
    authority.observe(error),
  );
  return (
    <section className={styles.panel} aria-label="测评运营摘要">
      <h2>运营摘要</h2>
      <p className={styles.note}>
        读取服务器现状，分开查看当前草稿与历史记录；操作仍在各自工作区完成。
      </p>
      {read.loading && <p role="status">正在读取运营摘要，旧摘要已撤下…</p>}
      {read.error && (
        <div className={`${styles.status} ${styles.error}`} role="alert">
          <p>运营摘要读取失败，当前状态无法判定。{read.error}</p>
        </div>
      )}
      {read.value && <OperationsSummary value={read.value} />}
      <button
        type="button"
        className={`${styles.button} ${styles.secondary}`}
        disabled={read.loading}
        onClick={read.refresh}
      >
        {read.error ? "重新读取运营摘要" : "刷新运营摘要"}
      </button>
    </section>
  );
}
