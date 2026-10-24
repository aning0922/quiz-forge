"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { AsOf, OperationsSummary } from "./operations-ui/summary";
import operationsStyles from "./operations-ui/summary.module.css";
import { useOperationsDashboard } from "./operations-ui/read";
import ui from "./studio.module.css";
import styles from "./platform.module.css";

export function StudioDashboard({ canCreate }: { canCreate: boolean }) {
  const read = useOperationsDashboard();
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1>工作台</h1>
          <p>从测评目录开始，进入内容管理和内测运营。</p>
        </div>
        {canCreate && (
          <Link className={ui.link} href="/studio/new-product">
            <Plus size={19} aria-hidden="true" />
            新建测评
          </Link>
        )}
      </header>
      {!canCreate && (
        <p className={styles.info}>
          当前身份为只读，可浏览测评目录和已有记录，不能创建或修改测评。
        </p>
      )}
      {read.loading && (
        <p className={ui.status} role="status">
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
          <AsOf value={read.value.asOf} />
          <div className={operationsStyles.metrics}>
            {(
              [
                [
                  "目录测评总量",
                  read.value.directoryTotal,
                  "包含未归档和已归档的测评。",
                ],
                [
                  "有当前草稿",
                  read.value.activeDrafts,
                  "仅统计未归档且有当前草稿的测评。",
                ],
                [
                  "当前草稿缺匹配审核",
                  read.value.activeMissingReview,
                  "仅统计未归档、有当前草稿且缺少完整目标匹配审核的测评。",
                ],
              ] as const
            ).map(([label, metric, description]) => (
              <section key={label} className={styles.panel} aria-label={label}>
                <h2>{label}</h2>
                <div className={styles.metric}>{metric.count}</div>
                <p>{description}</p>
                <Link className={ui.link} href={metric.href}>
                  查看对应测评 →
                </Link>
              </section>
            ))}
          </div>
        </>
      )}
      <div className={styles.columns}>
        <section className={styles.panel}>
          <div className={styles.sectionHeading}>
            <h2>最近创建的测评</h2>
            <Link className={styles.textLink} href="/studio/products">
              查看全部测评 →
            </Link>
          </div>
          <p>
            按创建时间倒序显示最多 5
            项，含归档测评；这不是最近业务更新或内容进度。
          </p>
          {read.value &&
            (read.value.recentCreated.length ? (
              <ul className={styles.recent}>
                {read.value.recentCreated.map((operations) => {
                  const product = operations.directory;
                  return (
                    <li key={product.id}>
                      <div className={styles.row}>
                        <div>
                          <h3>
                            {product.title}
                            <span className={styles.badge}>
                              {product.archivedAt ? "已归档" : "未归档"}
                            </span>
                          </h3>
                          <p>编号：{product.id}</p>
                          <p>
                            创建于{" "}
                            <time dateTime={product.createdAt}>
                              {new Intl.DateTimeFormat("zh-CN", {
                                timeZone: "Asia/Taipei",
                                dateStyle: "medium",
                                timeStyle: "short",
                              }).format(new Date(product.createdAt))}
                            </time>
                          </p>
                        </div>
                        <Link
                          className={styles.textLink}
                          href={`/studio/products/${encodeURIComponent(product.id)}`}
                          aria-label={`打开测评 ${product.title}`}
                        >
                          打开测评 →
                        </Link>
                      </div>
                      <OperationsSummary value={operations} compact />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className={ui.status}>
                当前目录尚无测评。
                {canCreate
                  ? "可以新建测评，再导入内容。"
                  : "运营人员创建测评后，可在这里查看。"}
              </p>
            ))}
          {read.value && (
            <div className={styles.actions}>
              <button
                className={`${ui.button} ${ui.secondary}`}
                type="button"
                onClick={read.refresh}
              >
                刷新工作台摘要
              </button>
            </div>
          )}
        </section>
        <section className={styles.panel}>
          <h2>运营入口</h2>
          <ul className={styles.recent}>
            <li>
              <Link className={styles.textLink} href="/studio/settings">
                分类与系统设置 →
              </Link>
              <p>整理分类和标签，查看身份与维护入口。</p>
            </li>
            <li>
              <Link className={styles.textLink} href="/studio/session">
                查看当前运营身份 →
              </Link>
              <p>核对当前角色、会话期限或退出登录。</p>
            </li>
          </ul>
          <p className={ui.note}>
            审核缺口按当前草稿完整目标匹配，历史审核不会计作当前审核。查看内测记录时，请先选择具体测评。
          </p>
        </section>
      </div>
    </div>
  );
}
