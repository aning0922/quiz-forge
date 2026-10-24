"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";
import type {
  Page,
  TaxonomyDto,
  TaxonomySummary,
} from "@/features/product/workspace/contracts";
import { useWorkspaceRead } from "./use-request";
import styles from "./tag-filter.module.css";

/** Directory-only read filter. The selected ID survives missing names and filtered pages. */
export function TagFilter({
  valueId,
  value,
  onChange,
  open,
  onOpenChange,
}: {
  valueId: string;
  value: TaxonomySummary | undefined;
  onChange: (value: TaxonomySummary | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [observed, setObserved] = useState<TaxonomySummary>();
  const [resolvedId, setResolvedId] = useState("");
  const resolveName = useCallback(
    (tagId: string, item: TaxonomySummary | undefined) => {
      setResolvedId(tagId);
      if (item) setObserved(item);
    },
    [],
  );
  const remember = useCallback(
    (item: TaxonomySummary) => setObserved(item),
    [],
  );
  const known =
    value?.id === valueId
      ? value
      : observed?.id === valueId
        ? observed
        : undefined;
  const label = !valueId
    ? "全部标签"
    : known
      ? `${known.name}${known.archivedAt ? "（已归档）" : ""}`
      : "已选标签（名称未读取）";
  const close = useCallback(
    (focus: boolean) => {
      onOpenChange(false);
      if (focus) trigger.current?.focus();
    },
    [onOpenChange],
  );
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current,
        panel = popup.current;
      if (!anchor || !panel) return;
      const rect = anchor.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) {
        onOpenChange(false);
        return;
      }
      const below = Math.max(0, innerHeight - rect.bottom - 12);
      const above = Math.max(0, rect.top - 12);
      const up = below < Math.min(360, above);
      const width = Math.min(Math.max(rect.width, 280), 440, innerWidth - 16);
      Object.assign(panel.style, {
        left: `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`,
        width: `${width}px`,
        maxHeight: `${Math.min(360, up ? above : below)}px`,
        top: up ? "auto" : `${rect.bottom + 6}px`,
        bottom: up ? `${innerHeight - rect.top + 6}px` : "auto",
        visibility: "visible",
      });
    };
    place();
    popup.current?.querySelector("input")?.focus();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, onOpenChange]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !trigger.current?.contains(event.target) &&
        !popup.current?.contains(event.target)
      )
        close(false);
    };
    // Paging clears the old result DOM; Escape must also work if focus falls to body.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, close]);
  return (
    <div className={styles.field}>
      {!open && valueId && !known && resolvedId !== valueId && (
        <SelectedTagName valueId={valueId} onResolved={resolveName} />
      )}
      <label id={`${id}-label`} htmlFor={`${id}-trigger`}>
        标签
      </label>
      <button
        ref={trigger}
        id={`${id}-trigger`}
        type="button"
        className={styles.trigger}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${id}-popup` : undefined}
        title={label}
        onClick={() => onOpenChange(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            onOpenChange(true);
          }
        }}
      >
        <span id={`${id}-value`}>{label}</span>
        <ChevronDown size={17} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            id={`${id}-popup`}
            role="dialog"
            aria-label="选择标签筛选"
            className={styles.popup}
            onKeyDown={(event) => {
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                const choices = Array.from(
                  popup.current?.querySelectorAll<HTMLButtonElement>(
                    "[data-tag-choice]",
                  ) ?? [],
                );
                const index = choices.indexOf(
                  event.target as HTMLButtonElement,
                );
                if (!choices.length || (index < 0 && event.key !== "ArrowDown"))
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? choices.length - 1
                      : event.key === "ArrowUp"
                        ? (index - 1 + choices.length) % choices.length
                        : (index + 1) % choices.length;
                choices[next]?.focus();
              }
            }}
          >
            <TagOptions
              valueId={valueId}
              unknown={Boolean(valueId && !known)}
              onObserved={remember}
              onChoose={(item) => {
                onChange(item);
                close(true);
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

/** One bounded first-page read; unmount/abort before the open popup owns its reads. */
function SelectedTagName({
  valueId,
  onResolved,
}: {
  valueId: string;
  onResolved: (tagId: string, value: TaxonomySummary | undefined) => void;
}) {
  const read = useWorkspaceRead<Page<TaxonomyDto>>(
    "/api/studio/tags?q=&page=1&pageSize=10&status=all",
  );
  useEffect(() => {
    if (read.value || read.error)
      onResolved(
        valueId,
        read.value?.items.slice(0, 10).find((item) => item.id === valueId),
      );
  }, [read.value, read.error, valueId, onResolved]);
  return null;
}

function TagOptions({
  valueId,
  unknown,
  onObserved,
  onChoose,
}: {
  valueId: string;
  unknown: boolean;
  onObserved: (item: TaxonomySummary) => void;
  onChoose: (item: TaxonomySummary | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({
    q,
    page: String(page),
    pageSize: "10",
    status: "all",
  });
  const read = useWorkspaceRead<Page<TaxonomyDto>>(
    `/api/studio/tags?${params}`,
  );
  useEffect(() => {
    const item = read.value?.items.find((item) => item.id === valueId);
    if (item) onObserved(item);
  }, [read.value, valueId, onObserved]);
  const applySearch = () => {
    setQ(search.trim());
    setPage(1);
  };
  return (
    <>
      <div className={styles.search}>
        <input
          aria-label="搜索标签名称或英文标识"
          placeholder="搜索标签…"
          maxLength={80}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              applySearch();
            }
          }}
        />
        <button type="button" onClick={applySearch} aria-label="搜索标签">
          <Search size={18} aria-hidden="true" />
        </button>
      </div>
      {unknown && (
        <p className={styles.notice}>
          已保留所选标签，名称尚未读取。可继续查找或清除筛选。
        </p>
      )}
      {valueId && (
        <button
          className={styles.clear}
          type="button"
          onClick={() => onChoose(null)}
        >
          清除标签筛选
        </button>
      )}
      {read.loading && <p role="status">正在读取标签…</p>}
      {read.error && (
        <div role="alert">
          <p>{read.error}</p>
          <button type="button" onClick={read.refresh}>
            重新读取标签
          </button>
        </div>
      )}
      {read.value && (
        <>
          {!read.value.items.length && (
            <p role="status">
              {q
                ? "没有匹配的标签，请更换搜索词。"
                : page > 1
                  ? "本页没有标签，请返回上一页。"
                  : "暂无标签可用于筛选。"}
            </p>
          )}
          <ul className={styles.options} aria-label="标签候选">
            {read.value.items.slice(0, 10).map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  data-tag-choice
                  aria-pressed={item.id === valueId}
                  onClick={() => onChoose(item)}
                >
                  <span>
                    {item.name}
                    {item.archivedAt ? "（已归档）" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {(page > 1 || read.value.hasNext) && (
            <nav className={styles.pagination} aria-label="标签分页">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                上一页
              </button>
              <span>第 {page} 页</span>
              <button
                type="button"
                disabled={!read.value.hasNext || page >= 1000}
                onClick={() => setPage((value) => value + 1)}
              >
                下一页
              </button>
            </nav>
          )}
        </>
      )}
    </>
  );
}
