"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useProductOperations } from "../operations-ui/read";
import { AsOf, ObservationValue } from "../operations-ui/summary";
import { ProductWorkspaceContext } from "./context";
import { ProductWorkspaceNav } from "./nav";
import {
  InternalAuthorityProvider,
  useInternalAuthority,
} from "../internal-versions/authority";
import { invalidateCurrentStudioAuthority } from "../authority-events";
import styles from "./workspace.module.css";

export function ProductWorkspaceFrame({
  productId,
  children,
}: {
  productId: string;
  children: ReactNode;
}) {
  return (
    <InternalAuthorityProvider productId={productId}>
      <WorkspaceFrameContent productId={productId}>
        {children}
      </WorkspaceFrameContent>
    </InternalAuthorityProvider>
  );
}

function WorkspaceFrameContent({
  productId,
  children,
}: {
  productId: string;
  children: ReactNode;
}) {
  const authority = useInternalAuthority();
  const read = useProductOperations(productId, (error) => {
    const wasRevoked = authority.isRevoked;
    authority.observe(error);
    if (!wasRevoked && authority.isRevoked) invalidateCurrentStudioAuthority();
  });
  const value = read.value;
  return (
    <ProductWorkspaceContext.Provider value={{ productId, read }}>
      <div className={styles.workspace}>
        <header className={styles.identity}>
          <Link className={styles.back} href="/studio/products">
            ← 测评管理
          </Link>
          <div className={styles.identityRow}>
            <div>
              <p className={styles.eyebrow}>测评工作区</p>
              <p className={styles.productName}>
                {value?.directory.title ?? "测评信息待读取"}
              </p>
              <p className={styles.muted}>编号：{productId}</p>
            </div>
            {value && (
              <span
                className={
                  value.directory.archivedAt ? styles.archived : styles.badge
                }
              >
                {value.directory.archivedAt ? "已归档" : "未归档"}
              </span>
            )}
          </div>
          {read.loading && <p role="status">正在读取测评摘要，旧摘要已撤下…</p>}
          {read.error && (
            <p className={styles.error} role="alert">
              摘要读取失败，当前业务状态无法判定。{read.error}
            </p>
          )}
          {value && (
            <>
              <div className={styles.businessFacts}>
                <div>
                  <span>当前草稿</span>
                  <strong>
                    <ObservationValue
                      observation={value.content.draft}
                      absent="暂无"
                    >
                      {(draft) => <>r{draft.target.revision}</>}
                    </ObservationValue>
                  </strong>
                </div>
                <div>
                  <span>当前匹配审核</span>
                  <strong>
                    <ObservationValue
                      observation={value.review.current}
                      absent="缺少精确匹配审核"
                    >
                      {(review) => <>r{review.target.revision} 的匹配依据</>}
                    </ObservationValue>
                  </strong>
                </div>
                <div>
                  <span>固定内容版本</span>
                  <strong>
                    当前 {value.versions.currentCount} · 历史{" "}
                    {value.versions.historicalCount}
                  </strong>
                </div>
                <div>
                  <span>试玩版本</span>
                  <strong>
                    当前 {value.testing.currentCount} · 历史{" "}
                    {value.testing.historicalCount}
                  </strong>
                </div>
              </div>
              <AsOf value={value.asOf} />
            </>
          )}
          <div className={styles.headerActions}>
            <button
              className={styles.refresh}
              type="button"
              disabled={read.loading}
              onClick={read.refresh}
            >
              {read.error ? "重新读取摘要" : "刷新业务摘要"}
            </button>
            <p className={styles.muted}>
              摘要仅供查看；历史记录、固定预览和未决操作各保留原目标。
            </p>
          </div>
        </header>
        <ProductWorkspaceNav productId={productId} />
        {authority.isRevoked && (
          <section className={styles.error} role="alert">
            <p>
              当前页的运营权限已失效。输入、文件和原操作记录仍保留，本页已停止接受新的操作。
            </p>
            <a href="/studio/login" target="_blank" rel="noopener">
              在新标签重新登录
            </a>
            <p>
              重新登录后请重新打开对应工作区核实原记录；刷新摘要不会恢复本页旧权限。
            </p>
          </section>
        )}
        <fieldset
          disabled={authority.isRevoked}
          className={styles.operationBoundary}
        >
          <div className={styles.body}>{children}</div>
        </fieldset>
      </div>
    </ProductWorkspaceContext.Provider>
  );
}
