"use client";

import Link from "next/link";
import { OperationsSummary } from "../operations-ui/summary";
import { useProductWorkspaceContext } from "./context";
import { productWorkspaceTabs } from "./navigation";
import styles from "./workspace.module.css";

export function ProductOverview() {
  const context = useProductWorkspaceContext();
  if (!context) throw new Error("PRODUCT_WORKSPACE_REQUIRED");
  const { productId, read } = context;
  const value = read.value;
  const tabs = productWorkspaceTabs(productId);
  const labels = {
    directory: "查看目录信息",
    imports: "接收与检查内容",
    draft: "查看当前草稿",
    preview: "预览具体内容",
    review: "查看审核依据",
    versions: "查看固定内容版本",
    testing: "查看试玩版本",
  } as const;
  return (
    <div>
      <div className={styles.pageHeading}>
        <h1>测评概览</h1>
        <p>分开查看当前制作对象与历史依据，再进入对应工作区继续。</p>
      </div>
      {read.loading && <p role="status">正在读取概览…</p>}
      {read.error && (
        <p className={styles.error} role="alert">
          概览暂不可用；可通过业务导航进入原工作区核对记录。
        </p>
      )}
      {value && (
        <div className={styles.overview}>
          <section className={styles.panel} aria-label="制作与历史依据">
            <h2>制作与历史依据</h2>
            <p className={styles.muted}>
              当前匹配依据与历史记录分别列出；任何历史版本都不代表当前草稿已审核。
            </p>
            <OperationsSummary value={value} showActions={false} />
          </section>
          <aside className={styles.aside}>
            <section className={styles.panel}>
              <h2>继续制作</h2>
              <p className={styles.muted}>按服务器提供的实际入口查看和操作。</p>
              <div className={styles.nextActions}>
                {value.nextActions
                  .filter((action) => action.kind !== "directory")
                  .map((action) => (
                    <Link key={action.kind} href={action.href}>
                      <strong>{labels[action.kind]} →</strong>
                      <span>{action.reason}</span>
                    </Link>
                  ))}
              </div>
              <Link className={styles.standaloneLink} href={tabs[1].href}>
                查看内容与素材 →
              </Link>
              <Link className={styles.standaloneLink} href={tabs[2].href}>
                选择内容体验预览 →
              </Link>
            </section>
            <section className={styles.panel}>
              <h2>目录信息</h2>
              <dl className={styles.directoryFacts}>
                <dt>分类</dt>
                <dd>
                  {value.directory.primaryCategory?.name ?? "未分类"}
                  {value.directory.primaryCategory?.archivedAt
                    ? "（已归档）"
                    : ""}
                </dd>
                <dt>标签</dt>
                <dd>
                  {value.directory.tags.length
                    ? value.directory.tags
                        .map(
                          (tag) =>
                            `${tag.name}${tag.archivedAt ? "（已归档）" : ""}`,
                        )
                        .join("、")
                    : "暂无标签"}
                </dd>
                <dt>英文标识</dt>
                <dd>{value.directory.slug}</dd>
              </dl>
              <Link className={styles.standaloneLink} href={tabs[5].href}>
                编辑基本设置 →
              </Link>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
