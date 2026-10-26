"use client";

import { useId, useRef, useState } from "react";
import type {
  Page,
  TaxonomyDto,
  TaxonomyKind,
  TaxonomySummary,
} from "@/features/product/workspace/contracts";
import { useWorkspaceRead } from "./use-request";
import task from "./product-create-task.module.css";

/** Creation-only picker: existing directory choices, searched and paged on demand. */
export function ProductCreateTaxonomy({
  kind,
  selected,
  onChange,
  disabled,
  onFailure,
}: {
  kind: TaxonomyKind;
  selected: TaxonomySummary[];
  onChange: (value: TaxonomySummary[]) => void;
  disabled: boolean;
  onFailure: (error: unknown) => void;
}) {
  const id = useId(),
    details = useRef<HTMLDetailsElement>(null),
    summary = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const label = kind === "category" ? "分类" : "标签";
  const read = useWorkspaceRead<Page<TaxonomyDto>>(
    open
      ? `/api/studio/${kind === "category" ? "categories" : "tags"}?${new URLSearchParams({ page: String(page), pageSize: "10", status: "active", q: query })}`
      : null,
    onFailure,
  );
  function close() {
    if (details.current) details.current.open = false;
    setOpen(false);
    summary.current?.focus();
  }
  return (
    <div className={task.choiceField}>
      <span id={`${id}-label`} className={task.label}>
        {label}
        {kind === "tag" ? `（${selected.length}/8）` : ""}
      </span>
      <details
        ref={details}
        className={task.picker}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        onKeyDownCapture={(event) => {
          if (
            event.key === "Enter" &&
            event.target === details.current?.querySelector("input")
          ) {
            event.preventDefault();
            event.stopPropagation();
            setQuery(search);
            setPage(1);
          }
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
      >
        <summary
          ref={summary}
          aria-labelledby={`${id}-label ${id}-value`}
          aria-disabled={disabled}
          onClick={(event) => {
            if (disabled) event.preventDefault();
          }}
        >
          <span id={`${id}-value`}>
            {selected.length
              ? selected.map((item) => item.name).join("、")
              : `选择${label}（可选）`}
          </span>
        </summary>
        <div className={task.choicePanel}>
          <label className={task.srOnly} htmlFor={`${id}-search`}>
            搜索{label}
          </label>
          <div className={task.choiceSearch}>
            <input
              id={`${id}-search`}
              value={search}
              placeholder={`搜索${label}`}
              disabled={disabled}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={80}
            />
            <button
              type="button"
              className={task.secondary}
              disabled={disabled}
              aria-label={`搜索${label}`}
              onClick={() => {
                setQuery(search);
                setPage(1);
              }}
            >
              查找
            </button>
            {selected.length > 0 && (
              <button
                type="button"
                className={task.secondary}
                disabled={disabled}
                onClick={() => {
                  onChange([]);
                  if (kind === "category") close();
                }}
              >
                清除
              </button>
            )}
          </div>
          {read.loading && <p role="status">正在读取{label}…</p>}
          {read.error && (
            <div role="alert">
              <p>{read.error}</p>
              <button
                type="button"
                className={task.secondary}
                disabled={disabled}
                onClick={read.refresh}
              >
                重新读取{label}
              </button>
            </div>
          )}
          {read.value && (
            <>
              <div className={task.choiceList}>
                {read.value.items.map((item) => {
                  const chosen = selected.some((value) => value.id === item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={task.choiceOption}
                      aria-pressed={chosen}
                      disabled={
                        disabled ||
                        (!chosen && kind === "tag" && selected.length >= 8)
                      }
                      onClick={() => {
                        onChange(
                          kind === "category"
                            ? [item]
                            : chosen
                              ? selected.filter((value) => value.id !== item.id)
                              : [...selected, item],
                        );
                        if (kind === "category") close();
                      }}
                    >
                      {item.name}
                      <span aria-hidden="true">{chosen ? "✓" : ""}</span>
                    </button>
                  );
                })}
              </div>
              {!read.value.items.length && (
                <p className={task.help}>
                  {query
                    ? `没有找到匹配的${label}，请调整搜索。`
                    : `暂无可选${label}，可先留空。`}
                </p>
              )}
              {(page > 1 || read.value.hasNext) && (
                <div className={task.choicePaging}>
                  <button
                    type="button"
                    className={task.secondary}
                    disabled={page === 1 || disabled}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    上一页
                  </button>
                  <span>第{page}页</span>
                  <button
                    type="button"
                    className={task.secondary}
                    disabled={!read.value.hasNext || disabled}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </details>
    </div>
  );
}
