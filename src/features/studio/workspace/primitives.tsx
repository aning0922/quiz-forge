"use client";

import Link from "next/link";
import styles from "./workspace.module.css";

export function WorkspaceNav() {
  return (
    <nav className={styles.nav} aria-label="Studio 导航">
      <Link className={`${styles.link} ${styles.secondary}`} href="/studio">
        身份与退出
      </Link>
      <Link
        className={`${styles.link} ${styles.secondary}`}
        href="/studio/products"
      >
        工作区
      </Link>
      <Link
        className={`${styles.link} ${styles.secondary}`}
        href="/studio/taxonomy"
      >
        类目与标签
      </Link>
    </nav>
  );
}

export function Pagination({
  page,
  hasNext,
  busy,
  onPage,
}: {
  page: number;
  hasNext: boolean;
  busy: boolean;
  onPage: (page: number) => void;
}) {
  return (
    <nav className={styles.actions} aria-label="分页">
      <button
        className={`${styles.button} ${styles.secondary}`}
        type="button"
        disabled={busy || page <= 1}
        onClick={() => onPage(page - 1)}
      >
        上一页
      </button>
      <span>第 {page} 页</span>
      <button
        className={`${styles.button} ${styles.secondary}`}
        type="button"
        disabled={busy || !hasNext || page >= 1000}
        onClick={() => onPage(page + 1)}
      >
        下一页
      </button>
    </nav>
  );
}

export function ReadOnlyNotice() {
  return (
    <p className={styles.status}>
      当前身份为只读，可查看本运营空间全部工作区与目录，不能创建、编辑、归档或恢复。
    </p>
  );
}
