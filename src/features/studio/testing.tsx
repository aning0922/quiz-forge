"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Search,
  RotateCcw,
  Users,
  ShieldCheck,
  Plus,
} from "lucide-react";
import type { Page, ProductDto } from "@/features/product/workspace/contracts";
import { useWorkspaceRead } from "./workspace/use-request";
import { testingProductsPath } from "./platform-queries";
import { directoryTime } from "./workspace/directory-time";
import styles from "./testing.module.css";

const tabs = [
  ["keys", "访问码管理"],
  ["participants", "参与记录"],
  ["versions", "内测版本"],
] as const;
type TestingTab = (typeof tabs)[number][0];

export function StudioTesting({ readOnly }: { readOnly: boolean }) {
  const [tab, setTab] = useState<TestingTab>("keys"),
    [search, setSearch] = useState(""),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1);
  const read = useWorkspaceRead<Page<ProductDto>>(testingProductsPath(q, page));
  function reset() {
    setSearch("");
    setQ("");
    setPage(1);
  }
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>内测运营</h1>
          <p>按测评查看访问码、内测版本和已有安全记录。</p>
        </div>
        <a
          className={styles.primary}
          href="#testing-directory"
          onClick={() => setTab("keys")}
        >
          <Plus size={18} aria-hidden="true" />
          {readOnly ? "查找测评记录" : "选择测评发码"}
        </a>
      </header>
      {readOnly && (
        <p className={styles.notice}>
          当前身份为只读，可查看已有记录；不能创建答题版本、发码或作废。
        </p>
      )}
      <section className={styles.panel}>
        <div className={styles.tabs} role="tablist" aria-label="内测运营视图">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              id={`testing-tab-${id}`}
              role="tab"
              aria-selected={tab === id}
              tabIndex={tab === id ? 0 : -1}
              onKeyDown={(event) => {
                const index = tabs.findIndex(([value]) => value === id);
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % tabs.length
                    : event.key === "ArrowLeft"
                      ? (index + tabs.length - 1) % tabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : undefined;
                if (next === undefined) return;
                event.preventDefault();
                const selected = tabs[next]![0];
                setTab(selected);
                document.getElementById(`testing-tab-${selected}`)?.focus();
              }}
              aria-controls={
                id === "participants"
                  ? "testing-participants"
                  : "testing-directory-panel"
              }
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          id="testing-directory-panel"
          role="tabpanel"
          aria-labelledby={`testing-tab-${tab === "versions" ? "versions" : "keys"}`}
          hidden={tab === "participants"}
        >
          <div className={styles.scope}>
            <strong>
              {tab === "versions" ? "按测评查看固定版本" : "按测评管理访问码"}
            </strong>
            <span className={styles.badge}>现有能力</span>
            <p>
              {tab === "versions"
                ? "选择测评，进入它的固定内容版本与来源详情。答题版本在该测评的内测发放中查看。"
                : "选择所属测评后查看安全记录、发码和核实原请求。当前未提供跨测评访问码合并查询。"}
            </p>
          </div>
          <form
            id="testing-directory"
            className={styles.filters}
            aria-label="查找内测测评"
            onSubmit={(event) => {
              event.preventDefault();
              setQ(search);
              setPage(1);
            }}
          >
            <div className={styles.search}>
              <Search size={18} aria-hidden="true" />
              <input
                aria-label="测评名称或编号"
                placeholder="搜索测评名称或编号"
                value={search}
                maxLength={80}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <button
              className={styles.button}
              type="submit"
              disabled={read.loading}
            >
              查找测评
            </button>
            <button className={styles.button} type="button" onClick={reset}>
              <RotateCcw size={16} aria-hidden="true" />
              重置
            </button>
          </form>
          {read.loading && (
            <p className={styles.feedback} role="status">
              正在读取测评目录…
            </p>
          )}
          {read.error && (
            <div className={styles.error} role="alert">
              <p>{read.error}</p>
              <button className={styles.button} onClick={read.refresh}>
                重新读取测评目录
              </button>
            </div>
          )}
          {read.value && (
            <>
              {!read.value.items.length && (
                <div className={styles.empty}>
                  <Search size={28} aria-hidden="true" />
                  <h2>
                    {q
                      ? "没有符合条件的测评"
                      : page > 1
                        ? "本页没有测评"
                        : "尚无测评"}
                  </h2>
                  <p>
                    {q
                      ? "调整关键词，或重置搜索后查看目录。"
                      : page > 1
                        ? "可以返回上一页，或刷新目录。"
                        : "先到测评管理创建测评，再准备内容与内测。"}
                  </p>
                  {q ? (
                    <button className={styles.button} onClick={reset}>
                      重置搜索
                    </button>
                  ) : (
                    <Link className={styles.button} href="/studio/products">
                      前往测评管理
                    </Link>
                  )}
                </div>
              )}
              {!!read.value.items.length && (
                <>
                  <div className={styles.tableHeading} aria-hidden="true">
                    <span>测评作品</span>
                    <span>目录状态</span>
                    <span>目录更新时间</span>
                    <span>操作</span>
                  </div>
                  <ul className={styles.records}>
                    {read.value.items.map((product) => (
                      <li key={product.id}>
                        <div className={styles.identity}>
                          <strong>{product.title}</strong>
                          <span>编号：{product.id}</span>
                        </div>
                        <span
                          className={
                            product.archivedAt ? styles.archived : styles.status
                          }
                        >
                          {product.archivedAt ? "已归档" : "未归档"}
                        </span>
                        <time dateTime={product.updatedAt}>
                          {directoryTime(product.updatedAt)}
                        </time>
                        <div className={styles.recordActions}>
                          <Link
                            className={styles.button}
                            href={`/studio/products/${encodeURIComponent(product.id)}?task=${tab === "versions" ? "review" : "testing"}`}
                            aria-label={`查看 ${product.title} 的${tab === "versions" ? "固定版本" : "内测"}`}
                          >
                            {tab === "versions"
                              ? "查看固定版本"
                              : "查看内测记录"}
                            <ArrowRight size={16} aria-hidden="true" />
                          </Link>
                          {tab === "versions" && (
                            <Link
                              className={styles.textLink}
                              href={`/studio/products/${encodeURIComponent(product.id)}?task=testing`}
                            >
                              答题版本
                            </Link>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <footer className={styles.listFooter}>
                <span>
                  测评目录共 {read.value.total} 款（含归档）· 本页{" "}
                  {read.value.items.length} 款
                </span>
                <nav aria-label="内测测评分页">
                  <button
                    className={styles.button}
                    disabled={page <= 1 || read.loading}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    上一页
                  </button>
                  <span>第 {page} 页</span>
                  <button
                    className={styles.button}
                    disabled={
                      !read.value.hasNext || page >= 1000 || read.loading
                    }
                    onClick={() => setPage((value) => value + 1)}
                  >
                    下一页
                  </button>
                  <button className={styles.button} onClick={read.refresh}>
                    刷新目录
                  </button>
                </nav>
              </footer>
            </>
          )}
        </div>
        <div
          id="testing-participants"
          role="tabpanel"
          aria-labelledby="testing-tab-participants"
          hidden={tab !== "participants"}
          className={styles.participants}
        >
          <div className={styles.sectionHeading}>
            <div>
              <h2>参与记录</h2>
              <p>已有会话与报告事实，尚无统一运营只读查询入口。</p>
            </div>
            <span className={styles.pending}>待接入查询层</span>
          </div>
          <div className={styles.explanationGrid}>
            <section>
              <h3>查询范围</h3>
              <p>
                全局参与检索尚未接入。这里不展示个人答案、原始凭证或可识别个人信息。
              </p>
            </section>
            <section>
              <h3>状态依据</h3>
              <p>
                领取、保存与完成是不同事实。不能由报告数量倒推浏览量、参与量或渠道转化。
              </p>
            </section>
          </div>
          <div className={styles.empty}>
            <Users size={30} aria-hidden="true" />
            <strong>参与查询尚未开放</strong>
            <p>此处不显示模拟参与记录，也不将缺少查询表示为零参与。</p>
          </div>
        </div>
      </section>
      <section className={`${styles.panel} ${styles.safety}`}>
        <div className={styles.sectionHeading}>
          <h2>安全与范围说明</h2>
          <span className={styles.available}>
            <ShieldCheck size={15} aria-hidden="true" />
            真实合同不变
          </span>
        </div>
        <p>
          访问码原始私密链接不能从服务器反查，安全记录按测评查看。作废、原请求核实及结果未知后的恢复均在原工作区按已有权限与协议处理。固定内测版本不代表正式公开发布。
        </p>
      </section>
    </div>
  );
}
