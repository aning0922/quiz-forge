"use client";

import { useState } from "react";
import Link from "next/link";
import type { Page, ProductDto } from "@/features/product/workspace/contracts";
import { useWorkspaceRead } from "./workspace/use-request";
import { testingProductsPath } from "./platform-queries";
import ui from "./studio.module.css";
import styles from "./platform.module.css";

export function StudioTesting({ readOnly }: { readOnly: boolean }) {
  const [search, setSearch] = useState(""),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1);
  const read = useWorkspaceRead<Page<ProductDto>>(testingProductsPath(q, page));
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1>内测运营</h1>
          <p>选择测评后，查看它的答题版本、访问码和原请求。</p>
        </div>
      </header>
      <div className={styles.info}>
        <p>
          当前暂无跨测评合并查询。以下是测评目录，不是访问码、参与量或完成情况汇总。
        </p>
      </div>
      {readOnly && (
        <p className={ui.status}>
          当前身份为只读，可查看已有内测记录；不能创建答题版本或发放访问码。
        </p>
      )}
      <section className={styles.panel}>
        <form
          className={styles.search}
          aria-label="查找内测测评"
          onSubmit={(event) => {
            event.preventDefault();
            setQ(search);
            setPage(1);
          }}
        >
          <div>
            <label htmlFor="testing-product-search">测评名称或编号</label>
            <input
              id="testing-product-search"
              className={ui.input}
              value={search}
              maxLength={80}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <button className={ui.button} type="submit" disabled={read.loading}>
            查找测评
          </button>
        </form>
        {read.loading && (
          <p className={ui.status} role="status">
            正在读取测评目录…
          </p>
        )}
        {read.error && (
          <div className={`${ui.status} ${ui.error}`} role="alert">
            <p>{read.error}</p>
            <button className={ui.button} type="button" onClick={read.refresh}>
              重新读取测评目录
            </button>
          </div>
        )}
        {read.value && (
          <>
            <p className={styles.description}>
              找到 {read.value.total} 个测评（含归档），第 {page} 页。
            </p>
            {!read.value.items.length && (
              <p className={ui.status}>
                {q
                  ? "未找到匹配的测评，请更换关键词。"
                  : page > 1
                    ? "本页没有测评，请返回上一页或刷新。"
                    : "当前还没有测评，可先到测评管理创建。"}
              </p>
            )}
            <ul className={styles.recent}>
              {read.value.items.map((product) => (
                <li key={product.id}>
                  <div className={styles.row}>
                    <div>
                      <h2>
                        {product.title}
                        <span className={styles.badge}>
                          {product.archivedAt ? "已归档" : "未归档"}
                        </span>
                      </h2>
                      <p>测评编号：{product.id}</p>
                    </div>
                    <Link
                      className={`${ui.link} ${ui.secondary}`}
                      href={`/studio/products/${encodeURIComponent(product.id)}/consumer-access`}
                      aria-label={`查看 ${product.title} 的内测`}
                    >
                      查看此测评内测
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
            <nav className={styles.pagination} aria-label="内测测评分页">
              <button
                className={`${ui.button} ${ui.secondary}`}
                type="button"
                disabled={page <= 1 || read.loading}
                onClick={() => setPage((value) => value - 1)}
              >
                上一页
              </button>
              <span>第 {page} 页</span>
              <button
                className={`${ui.button} ${ui.secondary}`}
                type="button"
                disabled={!read.value.hasNext || page >= 1000 || read.loading}
                onClick={() => setPage((value) => value + 1)}
              >
                下一页
              </button>
              <button
                className={`${ui.button} ${ui.secondary}`}
                type="button"
                onClick={read.refresh}
              >
                刷新目录
              </button>
            </nav>
          </>
        )}
        <div className={styles.actions}>
          <Link className={styles.textLink} href="/studio/products">
            前往测评管理 →
          </Link>
        </div>
      </section>
    </div>
  );
}
