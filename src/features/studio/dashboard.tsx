"use client";

import Link from "next/link";
import { ClipboardList, Plus, ArrowRight } from "lucide-react";
import type { Page, ProductDto } from "@/features/product/workspace/contracts";
import { useWorkspaceRead } from "./workspace/use-request";
import { DASHBOARD_PRODUCTS_PATH } from "./platform-queries";
import ui from "./studio.module.css";
import styles from "./platform.module.css";

export function StudioDashboard({ canCreate }: { canCreate: boolean }) {
  const read = useWorkspaceRead<Page<ProductDto>>(DASHBOARD_PRODUCTS_PATH);
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
      <div className={styles.summary}>
        <section className={styles.panel} aria-label="目录测评总量">
          <div className={styles.panelTitle}>
            <span>目录测评总量</span>
            <ClipboardList size={22} aria-hidden="true" />
          </div>
          <div className={styles.metric}>
            {read.value ? read.value.total : "—"}
          </div>
          <p>包含未归档和已归档的测评。</p>
          {read.loading && <p role="status">正在读取目录…</p>}
          {read.error && <p role="alert">目录暂未读取成功，当前不显示数量。</p>}
        </section>
        <section className={styles.panel}>
          <h2>开始运营</h2>
          <p>
            先找到测评，再处理内容、审核版本或发放访问码。每项操作仍在所属测评中完成。
          </p>
          <div className={styles.actions}>
            <Link className={ui.link} href="/studio/products">
              管理测评
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link
              className={`${ui.link} ${ui.secondary}`}
              href="/studio/testing"
            >
              选择测评查看内测
            </Link>
          </div>
        </section>
      </div>
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
          {read.loading && <p role="status">正在读取最近创建的测评…</p>}
          {read.error && (
            <div className={`${ui.status} ${ui.error}`} role="alert">
              <p>{read.error}</p>
              <button
                className={ui.button}
                type="button"
                onClick={read.refresh}
              >
                重新读取目录
              </button>
            </div>
          )}
          {read.value &&
            (read.value.items.length ? (
              <ul className={styles.recent}>
                {read.value.items.map((product) => (
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
                  </li>
                ))}
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
                刷新目录摘要
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
            当前工作台不汇总审核待办、参与量或完成率。查看内测记录时，请先选择具体测评。
          </p>
        </section>
      </div>
    </div>
  );
}
