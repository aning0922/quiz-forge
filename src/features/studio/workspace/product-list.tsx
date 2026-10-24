"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
  pushCatalogQuery,
  subscribeCatalogQuery,
  catalogQuerySnapshot,
  catalogServerSnapshot,
} from "./catalog-location";
import type {
  Page,
  ProductDto,
  ProductListQuery,
} from "@/features/product/workspace/contracts";
import type { StudioSessionDto } from "../contracts";
import { StudioPageHeader } from "../presentation/page-header";
import { useWorkspaceRead } from "./use-request";
import { Pagination, ReadOnlyNotice } from "./primitives";
import { CatalogFilters } from "./catalog-filters";
import { CatalogProducts } from "./catalog-products";
import {
  readCatalogQuery,
  catalogQueryString,
  type CatalogSearchParams,
} from "./list-query";
import styles from "./workspace.module.css";

export function ProductList({
  session,
  search = {},
}: {
  session: StudioSessionDto;
  search?: CatalogSearchParams;
}) {
  const liveSearch = useSyncExternalStore<string | null>(
    subscribeCatalogQuery,
    catalogQuerySnapshot,
    catalogServerSnapshot,
  );
  const result = readCatalogQuery(
    liveSearch === null ? search : new URLSearchParams(liveSearch),
  );
  return result.ok ? (
    <CatalogList
      key={catalogQueryString(result.query)}
      session={session}
      query={result.query}
    />
  ) : (
    <InvalidCatalogAddress message={result.message} />
  );
}

function InvalidCatalogAddress({ message }: { message: string }) {
  return (
    <div className={styles.workspace}>
      <StudioPageHeader title="测评管理" />
      <section className={styles.panel}>
        <h2>无法使用此列表地址</h2>
        <p className={`${styles.status} ${styles.error}`} role="alert">
          {message}
        </p>
        <div className={styles.actions}>
          <button
            className={styles.button}
            type="button"
            onClick={() => pushCatalogQuery(null)}
          >
            重置筛选并查看测评
          </button>
          <button
            className={`${styles.button} ${styles.secondary}`}
            onClick={() => window.history.back()}
          >
            返回上一页
          </button>
        </div>
      </section>
    </div>
  );
}

function CatalogList({
  session,
  query,
}: {
  session: StudioSessionDto;
  query: ProductListQuery;
}) {
  const read = useWorkspaceRead<Page<ProductDto>>(
    `/api/studio/products?${catalogQueryString(query)}`,
  );
  const filtered = Boolean(
    query.q ||
    query.categoryId ||
    query.tagId ||
    query.unclassified ||
    query.status !== "active",
  );
  const go = (value: ProductListQuery) => pushCatalogQuery(value);
  return (
    <div className={styles.workspace}>
      <StudioPageHeader
        title="测评管理"
        description={<p>查找测评、整理分类与标签，进入目录详情继续制作。</p>}
        actions={
          session.operator.role === "operator" ? (
            <Link className={styles.link} href="/studio/new-product">
              创建测评<span aria-hidden="true"> ＋</span>
            </Link>
          ) : undefined
        }
      />
      <section className={`${styles.panel} ${styles.catalogPanel}`}>
        {session.operator.role === "read-only" && <ReadOnlyNotice />}
        <CatalogFilters
          query={query}
          busy={read.loading}
          onApply={go}
          onReset={() => pushCatalogQuery(null)}
        />
        <p className={styles.filterSummary} role="status">
          当前：
          {query.status === "active"
            ? "未归档"
            : query.status === "archived"
              ? "已归档"
              : "全部测评"}
          {query.q && ` · 搜索“${query.q}”`}
          {query.categoryId && " · 已按分类筛选"}
          {query.tagId && " · 已按标签筛选"}
          {query.unclassified && " · 仅未分类"} · 按创建时间从新到旧
        </p>
        {read.loading && (
          <p className={styles.status} role="status">
            正在加载测评…
          </p>
        )}
        {read.error && (
          <div className={`${styles.status} ${styles.error}`} role="alert">
            <p>{read.error}</p>
            <button
              className={styles.button}
              type="button"
              onClick={read.refresh}
            >
              重新读取测评
            </button>
          </div>
        )}
        {read.value && (
          <>
            {!read.value.items.length ? (
              <div className={styles.emptyCatalog}>
                <h2>
                  {query.page > 1
                    ? "当前页没有测评"
                    : filtered
                      ? "当前筛选无结果"
                      : "尚无测评"}
                </h2>
                <p>
                  {query.page > 1
                    ? "该页没有记录。返回第一页保留筛选条件，或调整筛选。"
                    : filtered
                      ? "试试其他名称、归档状态、分类或标签。"
                      : "当前未归档目录还没有测评。可先创建测评，也可以切换归档状态。"}
                </p>
                <div className={styles.actions}>
                  {query.page > 1 && (
                    <button
                      className={styles.button}
                      onClick={() => go({ ...query, page: 1 })}
                    >
                      返回第一页
                    </button>
                  )}
                  {filtered && (
                    <button
                      className={`${styles.button} ${styles.secondary}`}
                      onClick={() => pushCatalogQuery(null)}
                    >
                      清除当前筛选
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <CatalogProducts products={read.value.items} />
            )}
            <footer className={styles.catalogFooter}>
              <p>
                共 {read.value.total} 个测评 · 每页 {query.pageSize} 个
              </p>
              <Pagination
                page={query.page}
                hasNext={read.value.hasNext}
                busy={read.loading}
                onPage={(page) => go({ ...query, page })}
              />
              <button
                className={`${styles.button} ${styles.secondary}`}
                type="button"
                onClick={read.refresh}
              >
                刷新列表
              </button>
            </footer>
          </>
        )}
      </section>
      <p className={styles.note}>
        这里只显示测评目录信息。内容检查、审核依据和内测进度请进入具体测评查看。
      </p>
    </div>
  );
}
