"use client";
import { useOwnedStudioSession } from "../accounts/session-owner";
import { roleHasCapability } from "@/lib/auth/role-policy";

import { useSyncExternalStore } from "react";
import {
  pushCatalogQuery,
  subscribeCatalogQuery,
  catalogQuerySnapshot,
  catalogServerSnapshot,
} from "./catalog-location";
import type { OperationsQuery } from "../operations/contracts";
import { AsOf } from "../operations-ui/summary";
import type { StudioSessionDto } from "../contracts";
import { StudioPageHeader } from "../presentation/page-header";
import { useOperationsProducts } from "../operations-ui/read";
import { Pagination, ReadOnlyNotice } from "./primitives";
import { CatalogFilters } from "./catalog-filters";
import { CatalogProducts } from "./catalog-products";
import {
  readCatalogQuery,
  catalogQueryString,
  type CatalogSearchParams,
} from "./list-query";
import styles from "./workspace.module.css";
import parity from "./catalog-parity.module.css";
import { ProductCreateTask, ProductCreateAction } from "./product-create-task";

export function ProductList({
  session: initialSession,
  search = {},
}: {
  session: StudioSessionDto;
  search?: CatalogSearchParams;
}) {
  const session = useOwnedStudioSession(initialSession);
  const liveSearch = useSyncExternalStore<string | null>(
    subscribeCatalogQuery,
    catalogQuerySnapshot,
    catalogServerSnapshot,
  );
  const result = readCatalogQuery(
    liveSearch === null ? search : new URLSearchParams(liveSearch),
  );
  return (
    <ProductCreateTask session={session}>
      {result.ok ? (
        <CatalogList session={session} query={result.query} />
      ) : (
        <InvalidCatalogAddress message={result.message} />
      )}
    </ProductCreateTask>
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
  session: initialSession,
  query,
}: {
  session: StudioSessionDto;
  query: OperationsQuery;
}) {
  const session = useOwnedStudioSession(initialSession);
  const read = useOperationsProducts(query);
  const filtered = Boolean(
    query.q ||
    query.categoryId ||
    query.tagId ||
    query.unclassified ||
    query.status !== "active" ||
    query.draft !== "any" ||
    query.review !== "any",
  );
  const go = (value: OperationsQuery) => pushCatalogQuery(value);
  return (
    <div className={`${styles.workspace} ${parity.page}`}>
      <StudioPageHeader
        title="测评管理"
        description={
          <p>查找测评，识别当前内容与内测状态，再进入具体工作区继续。</p>
        }
        actions={
          roleHasCapability(session.operator.role, "workspace:write") ? (
            <ProductCreateAction />
          ) : undefined
        }
      />
      <section
        className={`${styles.panel} ${styles.catalogPanel} ${parity.panel}`}
      >
        {session.operator.role === "read-only" && <ReadOnlyNotice />}
        <CatalogFilters
          key={catalogQueryString(query)}
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
          {query.unclassified && " · 仅未分类"}
          {query.draft !== "any" &&
            (query.draft === "present" ? " · 有当前草稿" : " · 无当前草稿")}
          {query.review !== "any" &&
            (query.review === "current"
              ? " · 有精确匹配审核"
              : " · 有草稿但缺匹配审核")}{" "}
          · 按创建时间从新到旧
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
            <div className={styles.catalogObservation}>
              <AsOf value={read.value.asOf} />
            </div>
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
        历史版本不代表当前草稿已审核；完整依据与未决操作请进入对应工作区查看。
      </p>
    </div>
  );
}
