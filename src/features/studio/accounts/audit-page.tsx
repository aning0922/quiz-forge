"use client";
import { useState } from "react";
import Link from "next/link";
import { useWorkspaceRead } from "../workspace/use-request";
import type { AccountAuditListDto } from "./contracts";
import { accountActionLabel } from "./presentation";
import styles from "./accounts.module.css";
export function AccountAuditPage() {
  const [offset, setOffset] = useState(0);
  const read = useWorkspaceRead<AccountAuditListDto>(
    `/api/studio/accounts/audit?offset=${offset}&limit=25`,
  );
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>账号操作记录</h1>
          <p>仅展示账号业务动作及原操作编号，不包含密码或设置入口。</p>
        </div>
        <Link href="/studio/accounts">返回账号管理</Link>
      </header>
      {read.loading && <p role="status">正在读取操作记录…</p>}
      {read.error && (
        <p role="alert" className={styles.error}>
          {read.error}
        </p>
      )}
      {read.value && (
        <>
          <div className={styles.cards}>
            {read.value.items.map((item) => (
              <article className={styles.card} key={item.operationId}>
                <p>
                  <strong>{accountActionLabel(item.action)}</strong> ·{" "}
                  {item.status === "completed" ? "已完成" : "已拒绝"}
                </p>
                <p>
                  操作者：
                  {item.actorDisplayName ??
                    (item.action === "password-setup"
                      ? "设置链接持有人"
                      : "本机维护工具")}{" "}
                  → {item.targetDisplayName}
                </p>
                <p>{new Date(item.createdAt).toLocaleString("zh-CN")}</p>
                <details>
                  <summary>操作编号与结果</summary>
                  <p>
                    {item.operationId}
                    {item.errorCode ? ` · ${item.errorCode}` : ""}
                  </p>
                </details>
              </article>
            ))}
          </div>
          {!read.value.items.length && (
            <p className={styles.empty}>暂无账号操作记录。</p>
          )}
          <nav className={styles.pagination} aria-label="操作记录分页">
            <button
              disabled={!offset}
              onClick={() => setOffset((value) => Math.max(0, value - 25))}
            >
              上一页
            </button>
            <span>第 {Math.floor(offset / 25) + 1} 页</span>
            <button
              disabled={!read.value.hasMore}
              onClick={() => setOffset((value) => value + 25)}
            >
              下一页
            </button>
            <button className={styles.secondary} onClick={read.refresh}>
              刷新记录
            </button>
          </nav>
        </>
      )}
    </div>
  );
}
