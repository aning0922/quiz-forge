"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { History, Settings } from "lucide-react";
import { useProductOperations } from "../operations-ui/read";
import { ProductWorkspaceContext } from "./context";
import { ProductWorkspaceNav } from "./nav";
import { WorkspaceAside } from "./aside";
import { useStudioLeaveGate } from "../navigation-boundary";
import {
  InternalAuthorityProvider,
  useInternalAuthority,
} from "../internal-versions/authority";
import { invalidateCurrentStudioAuthority } from "../authority-events";
import styles from "./task-workspace.module.css";

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
  const allowLeave = useStudioLeaveGate();
  const router = useRouter();
  const read = useProductOperations(productId, (error) => {
    const wasRevoked = authority.isRevoked;
    authority.observe(error);
    if (!wasRevoked && authority.isRevoked) invalidateCurrentStudioAuthority();
  });
  const base = `/studio/products/${encodeURIComponent(productId)}`;
  const detail = usePathname() !== base;
  return (
    <ProductWorkspaceContext.Provider value={{ productId, read }}>
      {detail ? (
        <div className={styles.workspace}>
          <header className={styles.heading}>
            <div>
              <Link href="/studio/products" className={styles.kicker}>
                测评管理 / 测评工作区
              </Link>
              <div className={styles.titleRow}>
                <h1>{read.value?.directory.title ?? "测评工作区"}</h1>
              </div>
              <p className={styles.subtitle}>
                精确对象详情 · 所选来源、修订或版本保持固定
              </p>
            </div>
            <div className={styles.actions}>
              <Link href={`${base}?task=content&panel=history`}>
                <History size={18} aria-hidden="true" />
                记录与历史
              </Link>
              <Link href={`${base}?task=content&panel=settings`}>
                <Settings size={18} aria-hidden="true" />
                基本设置
              </Link>
            </div>
          </header>
          <ProductWorkspaceNav productId={productId} />
          {read.error && (
            <p className={styles.notice} role="alert">
              摘要读取失败，精确对象详情仍保持原目标。{read.error}
            </p>
          )}
          {authority.isRevoked && (
            <p className={styles.notice} role="alert">
              当前权限已失效，原任务与目标保留，写入已停止。
            </p>
          )}
          <div className={styles.workspaceGrid}>
            <div className={styles.detailBody}>{children}</div>
            <WorkspaceAside
              value={read.value}
              onHistory={() => {
                if (allowLeave())
                  router.push(`${base}?task=content&panel=history`);
              }}
            />
          </div>
        </div>
      ) : (
        children
      )}
    </ProductWorkspaceContext.Provider>
  );
}
