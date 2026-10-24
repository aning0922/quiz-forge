"use client";
import { ChevronRight, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { studioLocation, type StudioIdentity } from "./navigation-model";
import styles from "./studio.module.css";

export function StudioTopbar({
  identity,
}: {
  identity?: StudioIdentity | undefined;
}) {
  const location = studioLocation(usePathname());
  return (
    <header className={styles.topbar}>
      <div className={styles.breadcrumb} aria-label="当前位置">
        <span>运营管理</span>
        <ChevronRight size={17} aria-hidden="true" />
        <strong>{location.title}</strong>
      </div>
      <div className={styles.topbarActions}>
        <form
          className={styles.topSearch}
          action="/studio/products"
          method="GET"
          data-studio-navigation-form
          aria-label="搜索测评"
        >
          <input
            type="search"
            name="q"
            aria-label="搜索测评名称或编号"
            placeholder="输入名称或编号"
            maxLength={80}
          />
          <button type="submit" aria-label="搜索测评">
            <Search size={20} aria-hidden="true" />
          </button>
        </form>
        {identity && (
          <span className={styles.roleBadge}>
            {identity.role === "operator" ? "运营者" : "只读"}
          </span>
        )}
      </div>
    </header>
  );
}
