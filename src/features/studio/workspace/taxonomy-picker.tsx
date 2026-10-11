"use client";

import { useId, useState } from "react";
import type {
  Page,
  TaxonomyDto,
  TaxonomyKind,
  TaxonomySummary,
} from "@/features/product/workspace/contracts";
import { useWorkspaceRead } from "./use-request";
import { Pagination } from "./primitives";
import styles from "./workspace.module.css";

export function taxonomyPath(kind: TaxonomyKind) {
  return kind === "category" ? "/api/studio/categories" : "/api/studio/tags";
}

export function TaxonomyPicker({
  kind,
  selected,
  onChange,
  disabled = false,
  purpose = "association",
}: {
  kind: TaxonomyKind;
  selected: TaxonomySummary[];
  onChange: (items: TaxonomySummary[]) => void;
  disabled?: boolean;
  purpose?: "association" | "filter";
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({
    page: String(page),
    pageSize: "10",
    status: purpose === "filter" ? "all" : "active",
    q,
  });
  const read = useWorkspaceRead<Page<TaxonomyDto>>(
    `${taxonomyPath(kind)}?${query}`,
  );
  const label = kind === "category" ? "主类目" : "标签";
  return (
    <section aria-label={`${label}选择`}>
      <p className={styles.legend}>
        {label}
        {kind === "tag" && purpose === "association"
          ? `（${selected.length}/8）`
          : "（最多一个）"}
      </p>
      <ul className={styles.cards}>
        {selected.map((item) => (
          <li key={item.id} className={styles.choice}>
            <span className={styles.selectedLabel}>
              {item.name} · {item.slug}
              {item.archivedAt
                ? purpose === "filter"
                  ? " · 已归档"
                  : " · 已归档（可保留或移除）"
                : ""}
            </span>
            <button
              className={`${styles.button} ${styles.secondary} ${styles.removeButton}`}
              type="button"
              disabled={disabled}
              aria-label={`移除${label} ${item.slug}`}
              onClick={() =>
                onChange(selected.filter((value) => value.id !== item.id))
              }
            >
              移除
            </button>
          </li>
        ))}
      </ul>
      <div className={styles.field}>
        <label htmlFor={id}>搜索可关联{label}名称或 slug</label>
        <input
          id={id}
          className={styles.input}
          value={search}
          disabled={disabled}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button
          className={`${styles.button} ${styles.secondary}`}
          type="button"
          disabled={disabled || read.loading}
          onClick={() => {
            setQ(search);
            setPage(1);
          }}
        >
          搜索{label}
        </button>
      </div>
      {read.loading && <p role="status">正在加载{label}…</p>}
      {read.error && (
        <div className={`${styles.status} ${styles.error}`} role="alert">
          <p>{read.error}</p>
          <button
            type="button"
            className={styles.button}
            onClick={read.refresh}
          >
            重新读取{label}
          </button>
        </div>
      )}
      {read.value && (
        <>
          {!read.value.items.length && (
            <p className={styles.note}>
              {purpose === "filter"
                ? `没有符合搜索的${label}。`
                : `没有可新增的${label}。可在类目与标签页创建或恢复目录。`}
            </p>
          )}
          <fieldset className={styles.choices} disabled={disabled}>
            <legend className={styles.legend}>
              可关联{label} · 第 {read.value.page} 页
            </legend>
            {read.value.items.map((item) => {
              const checked = selected.some((value) => value.id === item.id);
              return (
                <label className={styles.choice} key={item.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={
                      (purpose === "association" && Boolean(item.archivedAt)) ||
                      (kind === "tag" && !checked && selected.length >= 8)
                    }
                    onChange={() =>
                      onChange(
                        checked
                          ? selected.filter((value) => value.id !== item.id)
                          : kind === "category" || purpose === "filter"
                            ? [item]
                            : [...selected, item],
                      )
                    }
                  />
                  <span>
                    {item.name} · {item.slug}
                    {item.archivedAt ? " · 已归档" : ""}
                  </span>
                </label>
              );
            })}
          </fieldset>
          <Pagination
            page={page}
            hasNext={read.value.hasNext}
            busy={disabled || read.loading}
            onPage={setPage}
          />
        </>
      )}
    </section>
  );
}
