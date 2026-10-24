"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { RefreshCw, Eye, ArrowRight } from "lucide-react";
import { useProductOperations } from "../operations-ui/read";
import { productPresentation } from "../operations-ui/presentation";
import { StatusBadge } from "../operations-ui/status-badge";
import { directoryTime } from "../workspace/directory-time";
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
  const presentation = value ? productPresentation(value) : null;
  return (
    <ProductWorkspaceContext.Provider value={{ productId, read }}>
      <div className={styles.workspace}>
        <Link className={styles.back} href="/studio/products">
          测评管理 <span aria-hidden="true">/</span>{" "}
          <span>{value?.directory.title ?? "测评工作区"}</span>
        </Link>
        <header className={styles.identity}>
          <div className={styles.identityRow}>
            <div className={styles.identityMain}>
              {value && presentation && (
                <div className={styles.statuses}>
                  {value.directory.archivedAt && (
                    <StatusBadge
                      status={{ label: "已归档", tone: "neutral" }}
                    />
                  )}
                  {value.directory.primaryCategory && (
                    <StatusBadge
                      status={{
                        label: value.directory.primaryCategory.name,
                        tone: "neutral",
                      }}
                    />
                  )}
                  <StatusBadge status={presentation.content} />
                  <StatusBadge status={presentation.review} />
                </div>
              )}
              <p className={styles.productName}>
                {value?.directory.title ?? "测评信息待读取"}
              </p>
              {presentation?.historicalNote && (
                <p className={styles.historyNote}>
                  {presentation.historicalNote}
                </p>
              )}
            </div>
            {presentation && !authority.isRevoked && (
              <div className={styles.headerActions}>
                {presentation.previewHref && (
                  <Link
                    className={styles.secondary}
                    href={presentation.previewHref}
                  >
                    <Eye size={18} aria-hidden="true" />
                    体验预览
                  </Link>
                )}
                <Link
                  className={styles.primary}
                  href={presentation.primary.href}
                  title={presentation.primary.reason}
                >
                  {presentation.primary.label}
                  <ArrowRight size={18} aria-hidden="true" />
                </Link>
              </div>
            )}
          </div>
          <div className={styles.identityMeta}>
            {value && (
              <span>
                摘要观察{" "}
                <time dateTime={value.asOf}>{directoryTime(value.asOf)}</time>
              </span>
            )}
            <button
              className={styles.refresh}
              type="button"
              disabled={read.loading}
              onClick={read.refresh}
            >
              <RefreshCw size={16} aria-hidden="true" />
              {read.error ? "重新读取摘要" : "刷新摘要"}
            </button>
          </div>
          {read.loading && (
            <p role="status" className={styles.muted}>
              正在读取测评摘要…
            </p>
          )}
          {read.error && (
            <p className={styles.error} role="alert">
              摘要读取失败，当前业务状态无法判定。{read.error}
            </p>
          )}
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
