"use client";

import { useState } from "react";
import {
  productListQuerySchema,
  type ProductListQuery,
  type TaxonomySummary,
} from "@/features/product/workspace/contracts";
import { TaxonomyPicker } from "./taxonomy-picker";
import styles from "./workspace.module.css";

export function CatalogFilters({
  query,
  busy,
  onApply,
  onReset,
}: {
  query: ProductListQuery;
  busy: boolean;
  onApply: (query: ProductListQuery) => void;
  onReset: () => void;
}) {
  const [q, setQ] = useState(query.q ?? ""),
    [status, setStatus] = useState(query.status),
    [categoryId, setCategoryId] = useState(query.categoryId ?? ""),
    [tagId, setTagId] = useState(query.tagId ?? ""),
    [unclassified, setUnclassified] = useState(query.unclassified),
    [categories, setCategories] = useState<TaxonomySummary[]>([]),
    [tags, setTags] = useState<TaxonomySummary[]>([]),
    [error, setError] = useState("");
  return (
    <form
      className={styles.catalogFilters}
      aria-label="列表筛选"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = productListQuerySchema.safeParse({
          page: 1,
          pageSize: query.pageSize,
          status,
          q,
          unclassified,
          ...(categoryId ? { categoryId } : {}),
          ...(tagId ? { tagId } : {}),
        });
        if (!parsed.success) {
          setError("请检查筛选条件；搜索词最多 80 个字符，不能包含控制字符。");
          return;
        }
        setError("");
        onApply(parsed.data);
      }}
    >
      <div className={styles.field}>
        <label htmlFor="workspace-search">搜索测评名称或编号</label>
        <input
          id="workspace-search"
          className={styles.input}
          value={q}
          maxLength={160}
          placeholder="名称、编号或英文标识"
          onChange={(event) => setQ(event.target.value)}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="workspace-status">归档状态</label>
        <select
          id="workspace-status"
          className={styles.select}
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as ProductListQuery["status"])
          }
        >
          <option value="active">未归档</option>
          <option value="archived">已归档</option>
          <option value="all">全部</option>
        </select>
      </div>
      <div className={styles.catalogFilterActions}>
        <button className={styles.button} type="submit" disabled={busy}>
          应用筛选
        </button>
        <button
          className={`${styles.button} ${styles.secondary}`}
          type="button"
          disabled={busy}
          onClick={() => {
            setQ("");
            setStatus("active");
            setCategoryId("");
            setTagId("");
            setUnclassified(false);
            setCategories([]);
            setTags([]);
            setError("");
            onReset();
          }}
        >
          重置筛选
        </button>
      </div>
      {error && (
        <p className={`${styles.status} ${styles.error}`} role="alert">
          {error}
        </p>
      )}
      <details
        className={styles.expandedFilters}
        open={Boolean(query.categoryId || query.tagId || query.unclassified)}
      >
        <summary>
          <span>更多筛选</span>
          {categoryId || tagId || unclassified ? " · 已选分类或标签条件" : ""}
        </summary>
        <div className={styles.filterChoices}>
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={unclassified}
              onChange={(event) => {
                setUnclassified(event.target.checked);
                if (event.target.checked) {
                  setCategoryId("");
                  setCategories([]);
                }
              }}
            />
            仅未分类测评
          </label>
          <TaxonomyPicker
            purpose="filter"
            kind="category"
            selected={categories}
            selectedId={categoryId}
            onChange={(items) => {
              setCategories(items);
              setCategoryId(items[0]?.id ?? "");
              if (items.length) setUnclassified(false);
            }}
          />
          <TaxonomyPicker
            purpose="filter"
            kind="tag"
            selected={tags}
            selectedId={tagId}
            onChange={(items) => {
              setTags(items.slice(-1));
              setTagId(items.at(-1)?.id ?? "");
            }}
          />
        </div>
      </details>
    </form>
  );
}
