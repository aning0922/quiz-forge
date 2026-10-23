"use client";

import { useState } from "react";
import Link from "next/link";
import {
  type Page,
  type ProductDto,
  type TaxonomySummary,
} from "@/features/product/workspace/contracts";
import type { StudioSessionDto } from "../contracts";
import { useWorkspaceRead } from "./use-request";
import { WorkspaceNav, Pagination, ReadOnlyNotice } from "./primitives";
import { FilterBar } from "./filter-bar";
import { TaxonomyPicker } from "./taxonomy-picker";
import styles from "./workspace.module.css";
import { ProductCard } from "./product-card";
import { StudioPageHeader } from "../presentation/page-header";

export function ProductList({ session }: { session: StudioSessionDto }) {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState({
    q: "",
    status: "active",
    categoryId: "",
    tagId: "",
    unclassified: false,
  });
  const [categories, setCategories] = useState<TaxonomySummary[]>([]);
  const [tags, setTags] = useState<TaxonomySummary[]>([]);
  const [unclassified, setUnclassified] = useState(false);
  const params = new URLSearchParams({
    page: String(page),
    pageSize: "20",
    status: query.status,
    q: query.q,
    unclassified: String(query.unclassified),
  });
  if (query.categoryId) params.set("categoryId", query.categoryId);
  if (query.tagId) params.set("tagId", query.tagId);
  const read = useWorkspaceRead<Page<ProductDto>>(
    `/api/studio/products?${params}`,
  );
  const filtered = Boolean(
    query.q ||
    query.categoryId ||
    query.tagId ||
    query.unclassified ||
    query.status !== "active",
  );
  return (
    <div className={styles.workspace}>
      <WorkspaceNav />
      <StudioPageHeader
        title="测评工作区"
        description={<p>管理商品，进入各自的导入、草稿与内测流程。</p>}
        actions={
          session.operator.role === "operator" ? (
            <Link className={styles.link} href="/studio/new-product">
              创建商品
            </Link>
          ) : undefined
        }
      />
      <section className={styles.panel}>
        {session.operator.role === "read-only" && <ReadOnlyNotice />}
        <FilterBar
          busy={read.loading}
          onFilter={(q, status) => {
            setQuery({
              q,
              status,
              categoryId: categories[0]?.id ?? "",
              tagId: tags[0]?.id ?? "",
              unclassified,
            });
            setPage(1);
          }}
        >
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={unclassified}
              onChange={(event) => {
                setUnclassified(event.target.checked);
                if (event.target.checked) setCategories([]);
              }}
            />
            仅未分类工作区
          </label>
          <TaxonomyPicker
            purpose="filter"
            kind="category"
            selected={categories}
            onChange={(items) => {
              setCategories(items);
              if (items.length) setUnclassified(false);
            }}
          />
          <TaxonomyPicker
            purpose="filter"
            kind="tag"
            selected={tags}
            onChange={(items) => setTags(items.slice(-1))}
          />
        </FilterBar>
        <p className={styles.filterSummary} role="status">
          当前：
          {query.status === "active"
            ? "未归档"
            : query.status === "archived"
              ? "已归档"
              : "全部商品"}
          {query.q && ` · 搜索“${query.q}”`}
          {query.categoryId && " · 已按主类目筛选"}
          {query.tagId && " · 已按标签筛选"}
          {query.unclassified && " · 仅未分类"}
        </p>
        {read.loading && (
          <p className={styles.status} role="status">
            正在加载工作区…
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
              重新读取工作区
            </button>
          </div>
        )}
        {read.value && (
          <>
            <p className={styles.note}>共 {read.value.total} 个工作区</p>
            {!read.value.items.length && (
              <p className={styles.status}>
                {filtered ? "当前筛选无结果" : "尚无工作区"}
              </p>
            )}
            <ul className={styles.cards}>
              {read.value.items.map((product) => (
                <li key={product.id}>
                  <ProductCard product={product} />
                </li>
              ))}
            </ul>
            <Pagination
              page={page}
              hasNext={read.value.hasNext}
              busy={read.loading}
              onPage={setPage}
            />
            <button
              className={`${styles.button} ${styles.secondary}`}
              type="button"
              onClick={read.refresh}
            >
              刷新列表
            </button>
          </>
        )}
      </section>
    </div>
  );
}
