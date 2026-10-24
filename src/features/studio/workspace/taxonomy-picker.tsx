"use client";

import { useId, useState } from "react";
import Link from "next/link";
import type {
  Page,
  TaxonomyDto,
  TaxonomyKind,
  TaxonomySummary,
} from "@/features/product/workspace/contracts";
import { useWorkspaceRead } from "./use-request";
import { Pagination } from "./primitives";
import { TechnicalDetails } from "../presentation/technical-details";
import styles from "./workspace.module.css";
import local from "./taxonomy-picker.module.css";

export function taxonomyPath(kind: TaxonomyKind) {
  return kind === "category" ? "/api/studio/categories" : "/api/studio/tags";
}

/** A filtered miss or out-of-range page cannot prove there are no options. */
export function taxonomyOptionsAreEmpty(
  value: Page<TaxonomyDto> | undefined,
  query: string,
  page: number,
): boolean {
  return Boolean(
    value &&
    query === "" &&
    page === 1 &&
    value.total === 0 &&
    value.items.length === 0,
  );
}

export function TaxonomyPicker({
  kind,
  selected,
  onChange,
  disabled = false,
  purpose = "association",
  selectedId,
  compact = false,
  onFailure,
}: {
  kind: TaxonomyKind;
  selected: TaxonomySummary[];
  onChange: (items: TaxonomySummary[]) => void;
  disabled?: boolean;
  purpose?: "association" | "filter";
  selectedId?: string;
  compact?: boolean;
  onFailure?: ((error: unknown) => void) | undefined;
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
    onFailure,
  );
  const label = kind === "category" ? "分类" : "标签";
  const emptyOptions = taxonomyOptionsAreEmpty(read.value, q, page);
  const Options = compact ? "details" : "div";
  return (
    <section aria-label={`${label}选择`}>
      <p className={styles.legend}>
        {label}
        {kind === "tag" && purpose === "association"
          ? `（${selected.length}/8）`
          : "（最多一个）"}
      </p>
      {purpose === "filter" &&
        selectedId &&
        !selected.some((item) => item.id === selectedId) && (
          <div className={styles.selectedFilter}>
            <p>
              当前{label}：
              {read.value?.items.find((item) => item.id === selectedId)?.name ??
                "已按指定编号选择，名称尚未读取"}
            </p>
            <button
              className={`${styles.button} ${styles.secondary}`}
              type="button"
              disabled={disabled}
              onClick={() => onChange([])}
            >
              清除{label}筛选
            </button>
            <TechnicalDetails label={`${label}筛选编号`}>
              <p>{selectedId}</p>
            </TechnicalDetails>
          </div>
        )}
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
      <Options
        className={compact ? local.options : undefined}
        open={compact && read.error ? true : undefined}
      >
        {compact && (
          <summary>
            {read.loading
              ? `正在读取${label}…`
              : emptyOptions
                ? `暂无可选${label}`
                : `选择或调整${label}`}
          </summary>
        )}
        {!emptyOptions && (
          <div className={styles.field}>
            <label htmlFor={id}>搜索{label}名称或英文标识</label>
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
        )}
        {read.loading && <p role="status">正在加载{label}…</p>}
        {read.error && (
          <div className={`${styles.status} ${styles.error}`} role="alert">
            <p>{read.error}</p>
          </div>
        )}
        {read.value && (
          <>
            {!read.value.items.length && (
              <p className={styles.note}>
                {emptyOptions
                  ? purpose === "filter"
                    ? `暂无${label}可用于筛选。`
                    : selected.length
                      ? `暂无可新增的${label}，已选内容可保留或移除。`
                      : `暂无可选${label}，可暂不设置。`
                  : q
                    ? `没有符合搜索条件的${label}，请更换关键词。`
                    : `当前页没有可选${label}，请返回上一页。`}
              </p>
            )}
            {read.value.items.length > 0 && (
              <fieldset className={styles.choices} disabled={disabled}>
                <legend className={styles.legend}>
                  可关联{label} · 第 {read.value.page} 页
                </legend>
                {read.value.items.map((item) => {
                  const checked =
                    purpose === "filter" && selectedId !== undefined
                      ? selectedId === item.id
                      : selected.some((value) => value.id === item.id);
                  return (
                    <label className={styles.choice} key={item.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={
                          (purpose === "association" &&
                            Boolean(item.archivedAt)) ||
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
            )}
            {(page > 1 || read.value.hasNext) && (
              <Pagination
                page={page}
                hasNext={read.value.hasNext}
                busy={disabled || read.loading}
                onPage={setPage}
              />
            )}
          </>
        )}
        <div className={`${styles.actions} ${styles.pickerActions}`}>
          <Link
            className={`${styles.link} ${styles.secondary}`}
            href={compact ? "/studio/settings" : "/studio/taxonomy"}
            target="_blank"
            rel="noopener noreferrer"
          >
            管理分类与标签（新标签页）
          </Link>
          <button
            className={`${styles.button} ${styles.secondary}`}
            type="button"
            disabled={disabled || read.loading}
            onClick={read.refresh}
          >
            重新读取{label}
          </button>
        </div>
      </Options>
    </section>
  );
}
