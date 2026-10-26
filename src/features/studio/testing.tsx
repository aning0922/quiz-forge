"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Search, Users } from "lucide-react";
import type { Page, ProductDto } from "@/features/product/workspace/contracts";
import type { StudioSessionDto } from "./contracts";
import { useOwnedStudioSession } from "./accounts/session-owner";
import { useWorkspaceRead } from "./workspace/use-request";
import { testingProductsPath } from "./platform-queries";
import styles from "./testing.module.css";

const tabs = [
  ["keys", "访问码管理"],
  ["participants", "参与记录"],
  ["versions", "内测版本"],
] as const;
type TestingTab = (typeof tabs)[number][0];
export function StudioTesting({
  session: initialSession,
}: {
  session: StudioSessionDto;
}) {
  const session = useOwnedStudioSession(initialSession);
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
          <p className={styles.eyebrow}>QUIZFORGE STUDIO / OPERATOR</p>
          <h1>内测运营</h1>
          <p>按具体测评查看访问码、内测版本与安全记录。</p>
        </div>
      </header>
      {session.operator.role === "read-only" && (
        <p className={styles.notice}>
          当前身份为只读，可查看已有记录；不能创建答题版本、发码或作废。
        </p>
      )}
      <div className={styles.tabs} role="tablist" aria-label="内测运营视图">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            id={`testing-tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            aria-controls={
              id === "participants"
                ? "testing-participants"
                : "testing-directory-panel"
            }
            onClick={() => setTab(id)}
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
          >
            {label}
          </button>
        ))}
      </div>
      <section
        className={styles.panel}
        id="testing-directory-panel"
        role="tabpanel"
        aria-labelledby={`testing-tab-${tab === "versions" ? "versions" : "keys"}`}
        hidden={tab === "participants"}
      >
        <div className={styles.sectionHeading}>
          <div>
            <h2>
              {tab === "versions" ? "按测评查看固定版本" : "按测评管理访问码"}
            </h2>
            <p>进入所属测评，查看准确版本与已有记录。</p>
          </div>
        </div>
        <form
          className={styles.search}
          aria-label="查找内测测评"
          onSubmit={(event) => {
            event.preventDefault();
            setQ(search.trim());
            setPage(1);
          }}
        >
          <label htmlFor="testing-search">搜索测评</label>
          <div>
            <Search size={18} aria-hidden="true" />
            <input
              id="testing-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={80}
              placeholder="输入测评名称或编号"
            />
          </div>
          <button
            className={styles.primary}
            type="submit"
            disabled={read.loading}
          >
            查询
          </button>
          {q && (
            <button className={styles.button} type="button" onClick={reset}>
              重置
            </button>
          )}
        </form>
        {read.loading && (
          <p role="status" className={styles.notice}>
            正在读取测评…
          </p>
        )}
        {read.error && (
          <div role="alert" className={styles.error}>
            <p>测评列表读取失败，不能据此判断是否存在内测记录。{read.error}</p>
            <button
              className={styles.button}
              type="button"
              onClick={read.refresh}
            >
              重新读取
            </button>
          </div>
        )}
        {read.value && (
          <>
            {read.value.items.length ? (
              <ul className={styles.productList}>
                {read.value.items.map((product) => (
                  <li key={product.id}>
                    <div>
                      <h3>{product.title}</h3>
                      <p>
                        {product.primaryCategory?.name ?? "未分类"} ·{" "}
                        {product.slug}
                        {product.archivedAt ? " · 已归档" : ""}
                      </p>
                    </div>
                    <Link
                      className={styles.button}
                      href={`/studio/products/${encodeURIComponent(product.id)}?task=${tab === "versions" ? "review" : "testing"}`}
                    >
                      进入测评 <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.empty}>
                <h3>{q ? "没有符合条件的测评" : "尚无可查看的测评"}</h3>
                <p>
                  {q
                    ? "调整搜索条件后再试。"
                    : "创建测评并形成固定版本后，可在所属工作区开展内测。"}
                </p>
              </div>
            )}
            <footer className={styles.footer}>
              <span>
                共 {read.value.total} 个测评 · 第 {page} 页
              </span>
              <div>
                <button
                  className={styles.button}
                  type="button"
                  disabled={read.loading || page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  上一页
                </button>
                <button
                  className={styles.button}
                  type="button"
                  disabled={read.loading || !read.value.hasNext}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </button>
              </div>
            </footer>
          </>
        )}
      </section>
      <section
        className={`${styles.panel} ${styles.empty}`}
        id="testing-participants"
        role="tabpanel"
        aria-labelledby="testing-tab-participants"
        hidden={tab !== "participants"}
      >
        <Users size={28} aria-hidden="true" />
        <h2>统一参与查询尚未接入</h2>
        <p>
          目前尚不能跨测评查询参与会话、完成率和报告数量。已有内测记录仍可在所属测评中查看。
        </p>
      </section>
    </div>
  );
}
