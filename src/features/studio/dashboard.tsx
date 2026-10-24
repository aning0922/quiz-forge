"use client";

import Link from "next/link";
import { Plus, ArrowRight, ClipboardCheck } from "lucide-react";
import {
  useOperationsDashboard,
  useOperationsProducts,
} from "./operations-ui/read";
import { productPresentation } from "./operations-ui/presentation";
import { StatusBadge } from "./operations-ui/status-badge";
import { operationsQuerySchema, operationsListHref } from "./operations/query";
import { directoryTime } from "./workspace/directory-time";
import ui from "./studio.module.css";
import styles from "./platform.module.css";

const reviewQuery = operationsQuerySchema.parse({
  status: "active",
  draft: "present",
  review: "missing",
  page: 1,
  pageSize: 5,
});

export function StudioDashboard({ canCreate }: { canCreate: boolean }) {
  const read = useOperationsDashboard();
  const waiting = useOperationsProducts(reviewQuery);
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1>工作台</h1>
          <p>查看当前草稿与审核缺口，继续处理具体测评。</p>
        </div>
        {canCreate && (
          <Link className={ui.link} href="/studio/new-product">
            <Plus size={19} aria-hidden="true" />
            新建测评
          </Link>
        )}
      </header>
      {!canCreate && (
        <p className={styles.readOnlyLine}>
          当前身份为只读，可查看记录，不能创建或修改测评。
        </p>
      )}
      {read.loading && (
        <p role="status" className={ui.status}>
          正在读取工作台摘要…
        </p>
      )}
      {read.error && (
        <div className={`${ui.status} ${ui.error}`} role="alert">
          <p>工作台摘要读取失败，当前不显示数量。{read.error}</p>
          <button className={ui.button} type="button" onClick={read.refresh}>
            重新读取工作台摘要
          </button>
        </div>
      )}
      {read.value && (
        <>
          <div className={styles.dashboardMetrics}>
            {(
              [
                [
                  "目录测评总量",
                  read.value.directoryTotal,
                  "全部测评，含已归档",
                ],
                ["有当前草稿", read.value.activeDrafts, "未归档且有当前草稿"],
                [
                  "当前草稿缺匹配审核",
                  read.value.activeMissingReview,
                  "未归档且缺精确匹配依据",
                ],
              ] as const
            ).map(([label, metric, description]) => (
              <Link
                key={label}
                className={styles.dashboardMetric}
                href={metric.href}
                aria-label={`${label} ${metric.count}，查看对应测评`}
              >
                <span>{label}</span>
                <strong>{metric.count}</strong>
                <span>{description}</span>
              </Link>
            ))}
          </div>
          <div className={styles.dashboardObservation}>
            <p>
              指标 / 最近创建读取于{" "}
              <time dateTime={read.value.asOf}>
                {directoryTime(read.value.asOf)}
              </time>
            </p>
            <button
              className={styles.compactButton}
              type="button"
              onClick={read.refresh}
            >
              刷新工作台摘要
            </button>
          </div>
        </>
      )}
      <div className={styles.dashboardColumns}>
        <section
          className={`${styles.panel} ${styles.dashboardPanel}`}
          aria-label="当前草稿待核对审核"
        >
          <div className={styles.sectionHeading}>
            <h2>当前草稿待核对审核</h2>
            <Link
              className={styles.textLink}
              href={operationsListHref(reviewQuery)}
            >
              查看该集合 →
            </Link>
          </div>
          <p className={styles.queueScope}>
            仅未归档、有当前草稿但缺精确匹配审核的测评，按创建时间列出最多 5
            条。
          </p>
          {waiting.loading && <p role="status">正在读取待核对测评…</p>}
          {waiting.error && (
            <div role="alert" className={`${ui.status} ${ui.error}`}>
              <p>
                待核对列表读取失败，不能据此判断是否存在审核缺口。
                {waiting.error}
              </p>
              <button
                type="button"
                className={styles.compactButton}
                onClick={waiting.refresh}
              >
                重新读取待核对列表
              </button>
            </div>
          )}
          {waiting.value && (
            <>
              {waiting.value.items.length ? (
                <ul className={styles.dashboardList}>
                  {waiting.value.items.map((operations) => {
                    const facts = productPresentation(operations);
                    return (
                      <li
                        key={operations.directory.id}
                        className={styles.queueRow}
                      >
                        <ClipboardCheck
                          className={styles.taskIcon}
                          size={22}
                          aria-hidden="true"
                        />
                        <div className={styles.queueIdentity}>
                          <h3>{operations.directory.title}</h3>
                          <StatusBadge status={facts.review} />
                        </div>
                        <Link
                          className={styles.compactButton}
                          href={`/studio/products/${encodeURIComponent(operations.directory.id)}?task=review`}
                          title={facts.primary.reason}
                          aria-label={`${facts.primary.label} ${operations.directory.title}`}
                        >
                          {facts.primary.label}
                          <ArrowRight size={16} aria-hidden="true" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className={styles.dashboardEmpty}>
                  此次读取没有符合该条件的测评。
                </p>
              )}
              <div className={styles.dashboardObservation}>
                <p>
                  集合共 {waiting.value.total} 项 · 独立读取于{" "}
                  <time dateTime={waiting.value.asOf}>
                    {directoryTime(waiting.value.asOf)}
                  </time>
                </p>
                <button
                  type="button"
                  className={styles.compactButton}
                  onClick={waiting.refresh}
                >
                  刷新待核对列表
                </button>
              </div>
            </>
          )}
        </section>
        <section
          className={`${styles.panel} ${styles.dashboardPanel}`}
          aria-label="最近创建的测评"
        >
          <div className={styles.sectionHeading}>
            <h2>最近创建的测评</h2>
            <Link className={styles.textLink} href="/studio/products">
              测评管理 →
            </Link>
          </div>
          <p className={styles.queueScope}>
            最多 5 条，含已归档；按创建时间排列。
          </p>
          {read.value &&
            (read.value.recentCreated.length ? (
              <ul className={styles.dashboardList}>
                {read.value.recentCreated.map((operations) => {
                  const product = operations.directory;
                  const facts = productPresentation(operations);
                  return (
                    <li key={product.id}>
                      <Link
                        className={styles.recentEntry}
                        href={`/studio/products/${encodeURIComponent(product.id)}`}
                        aria-label={`打开测评 ${product.title}`}
                      >
                        <div>
                          <h3>
                            {product.title}
                            {product.archivedAt ? " · 已归档" : ""}
                          </h3>
                          <span className={styles.recentFact}>
                            {facts.content.label}
                          </span>
                        </div>
                        <time dateTime={product.createdAt}>
                          {directoryTime(product.createdAt)}
                        </time>
                        <ArrowRight size={16} aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={styles.dashboardEmpty}>
                当前目录尚无测评。
                {canCreate ? "可以先新建测评。" : "创建后可在此查看。"}
              </p>
            ))}
          {read.loading && <p role="status">正在读取最近创建的测评…</p>}
          {read.error && <p>最近创建记录尚未读取成功。</p>}
        </section>
      </div>
      <nav className={styles.smallOperations} aria-label="低频运营入口">
        <span>运营入口</span>
        <Link href="/studio/testing">按测评查看内测 →</Link>
        <Link href="/studio/settings">分类与系统设置 →</Link>
        <Link href="/studio/session">当前运营身份 →</Link>
      </nav>
    </div>
  );
}
