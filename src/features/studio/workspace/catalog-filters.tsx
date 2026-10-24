"use client";

import { useState } from "react";
import { type TaxonomySummary } from "@/features/product/workspace/contracts";
import type { OperationsQuery } from "../operations/contracts";
import { operationsQuerySchema } from "../operations/query";
import { TaxonomyPicker } from "./taxonomy-picker";
import styles from "./workspace.module.css";

export function CatalogFilters({
  query,
  busy,
  onApply,
  onReset,
}: {
  query: OperationsQuery;
  busy: boolean;
  onApply: (query: OperationsQuery) => void;
  onReset: () => void;
}) {
  const [q, setQ] = useState(query.q ?? ""),
    [status, setStatus] = useState(query.status),
    [draft, setDraft] = useState(query.draft),
    [review, setReview] = useState(query.review),
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
        const parsed = operationsQuerySchema.safeParse({
          page: 1,
          pageSize: query.pageSize,
          status,
          draft,
          review,
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
            setStatus(event.target.value as OperationsQuery["status"])
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
            setDraft("any");
            setReview("any");
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
        open={Boolean(
          query.categoryId ||
          query.tagId ||
          query.unclassified ||
          query.draft !== "any" ||
          query.review !== "any",
        )}
      >
        <summary>
          <span>更多筛选</span>
          {categoryId ||
          tagId ||
          unclassified ||
          draft !== "any" ||
          review !== "any"
            ? " · 已选更多条件"
            : ""}
        </summary>
        <div className={styles.filterChoices}>
          <div className={styles.field}>
            <label htmlFor="operations-draft">当前草稿</label>
            <select
              id="operations-draft"
              className={styles.select}
              value={draft}
              onChange={(event) =>
                setDraft(event.target.value as OperationsQuery["draft"])
              }
            >
              <option value="any">不限草稿</option>
              <option value="present">有当前草稿</option>
              <option value="absent">无当前草稿</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="operations-review">当前草稿审核</label>
            <select
              id="operations-review"
              className={styles.select}
              value={review}
              onChange={(event) =>
                setReview(event.target.value as OperationsQuery["review"])
              }
            >
              <option value="any">不限审核</option>
              <option value="current">有精确匹配审核</option>
              <option value="missing">有草稿但缺匹配审核</option>
            </select>
          </div>
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
