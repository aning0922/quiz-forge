"use client";
import { useOwnedStudioSession } from "./accounts/session-owner";
import { roleHasCapability } from "@/lib/auth/role-policy";

import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  FileText,
  ShieldCheck,
  Info,
} from "lucide-react";
import type { StudioSessionDto } from "./contracts";
import {
  ProductCreateTask,
  ProductCreateAction,
} from "./workspace/product-create-task";
import parity from "./dashboard-parity.module.css";
import {
  useOperationsDashboard,
  useOperationsProducts,
} from "./operations-ui/read";
import {
  productPresentation,
  productPrimaryAction,
} from "./operations-ui/presentation";
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

export function StudioDashboard({
  session: initialSession,
}: {
  session: StudioSessionDto;
}) {
  const session = useOwnedStudioSession(initialSession);
  const canCreate = roleHasCapability(session.operator.role, "workspace:write");
  const read = useOperationsDashboard();
  const waiting = useOperationsProducts(reviewQuery);
  return (
    <ProductCreateTask session={session}>
      <div className={`${styles.page} ${parity.page}`}>
        <header className={styles.pageHeader}>
          <div>
            <p className={parity.eyebrow}>QUIZFORGE STUDIO / OPERATOR</p>
            <h1>工作台</h1>
            <p>优先处理需要你操作的测评，再回到具体工作区继续。</p>
          </div>
          {canCreate && <ProductCreateAction />}
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
            <div className={`${styles.dashboardMetrics} ${parity.metrics}`}>
              {(
                [
                  ["测评总量", read.value.directoryTotal, "含已归档", BookOpen],
                  ["内容草稿", read.value.activeDrafts, "未归档测评", FileText],
                  [
                    "待核对审核",
                    read.value.activeMissingReview,
                    "缺当前审核依据",
                    ShieldCheck,
                  ],
                ] as const
              ).map(([label, metric, description, Icon]) => (
                <Link
                  key={label}
                  className={`${styles.dashboardMetric} ${parity.metric}`}
                  href={metric.href}
                  aria-label={`${label} ${metric.count}，查看对应测评`}
                >
                  <span className={parity.metricIcon}>
                    <Icon size={19} aria-hidden="true" />
                  </span>
                  <span className={parity.metricLabel}>{label}</span>
                  <strong>{metric.count}</strong>
                  <span>{description}</span>
                </Link>
              ))}
            </div>
          </>
        )}
        <div className={`${styles.dashboardColumns} ${parity.columns}`}>
          <section
            className={`${styles.panel} ${styles.dashboardPanel}`}
            aria-label="当前草稿待核对审核"
          >
            <div className={styles.sectionHeading}>
              <h2>需要处理的工作</h2>
              <Link
                className={styles.textLink}
                href={operationsListHref(reviewQuery)}
              >
                查看待核对测评 →
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
                      const action = productPrimaryAction(
                        operations,
                        session.operator.role,
                      );
                      return (
                        <li
                          key={operations.directory.id}
                          className={styles.queueRow}
                        >
                          <div className={styles.queueIdentity}>
                            <h3>{operations.directory.title}</h3>
                            <p className={parity.taskDescription}>
                              {facts.review.label} · {action.reason}
                            </p>
                          </div>
                          <Link
                            className={styles.compactButton}
                            href={action.href}
                            title={action.reason}
                            aria-label={`${action.label} ${operations.directory.title}`}
                          >
                            {action.label}
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
                              {facts.content.label} ·{" "}
                              {product.primaryCategory?.name ?? "未分类"}
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
        <section className={`${styles.panel} ${parity.scopePanel}`}>
          <div>
            <h2>关于工作台数据</h2>
            <p>
              测评、草稿和审核分别按当前记录显示；参与人数、销售额和全局访问码统计尚未开放。
            </p>
            {read.value && (
              <p className={parity.observedAt}>
                摘要读取于{" "}
                <time dateTime={read.value.asOf}>
                  {directoryTime(read.value.asOf)}
                </time>
              </p>
            )}
          </div>
          <button
            className={styles.compactButton}
            type="button"
            onClick={read.refresh}
            disabled={read.loading}
          >
            刷新摘要 <Info size={17} aria-hidden="true" />
          </button>
        </section>
      </div>
    </ProductCreateTask>
  );
}
