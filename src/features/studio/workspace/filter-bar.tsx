"use client";

import { useState, type ReactNode } from "react";
import styles from "./workspace.module.css";

export function FilterBar({
  busy,
  onFilter,
  children,
  searchLabel = "搜索名称或英文标识",
}: {
  busy: boolean;
  onFilter: (q: string, status: string) => void;
  children?: ReactNode;
  searchLabel?: string;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("active");
  return (
    <form
      className={styles.filterBar}
      onSubmit={(event) => {
        event.preventDefault();
        onFilter(q, status);
      }}
      aria-label="列表筛选"
    >
      <div className={styles.field}>
        <label htmlFor="workspace-search">{searchLabel}</label>
        <input
          className={styles.input}
          id="workspace-search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="workspace-status">归档状态</label>
        <select
          className={styles.select}
          id="workspace-status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="active">未归档</option>
          <option value="archived">已归档</option>
          <option value="all">全部</option>
        </select>
      </div>
      {children && (
        <details className={styles.expandedFilters}>
          <summary>更多筛选</summary>
          <div className={styles.filterChoices}>{children}</div>
        </details>
      )}
      <button className={styles.button} type="submit" disabled={busy}>
        应用筛选
      </button>
    </form>
  );
}
