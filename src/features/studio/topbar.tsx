"use client";
import { roleLabel } from "./accounts/presentation";
import { ChevronRight, Search, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { studioLocation, type StudioIdentity } from "./navigation-model";
import styles from "./studio.module.css";
import { useStudioMobileNavigation } from "./mobile-navigation";

export function StudioTopbar({
  identity,
}: {
  identity?: StudioIdentity | undefined;
}) {
  const pathname = usePathname();
  const location = studioLocation(pathname);
  const productWorkspace = /^\/studio\/products\/[^/]+$/.test(pathname);
  const { registerTrigger, id, expanded, open } = useStudioMobileNavigation();
  return (
    <header className={styles.topbar}>
      <div className={styles.topbarLocation}>
        <button
          ref={registerTrigger}
          className={styles.menuButton}
          type="button"
          aria-label="打开 Studio 导航"
          aria-haspopup="dialog"
          aria-controls={id}
          aria-expanded={expanded}
          onClick={open}
        >
          <Menu size={22} aria-hidden="true" />
        </button>
        <div className={styles.breadcrumb} aria-label="当前位置">
          <span>运营管理</span>
          <ChevronRight size={17} aria-hidden="true" />
          <strong>{location.title}</strong>
        </div>
      </div>
      <div className={styles.topbarActions}>
        {!productWorkspace && (
          <form
            className={styles.topSearch}
            action="/studio/products"
            method="GET"
            data-studio-navigation-form
            aria-label="搜索测评"
          >
            <button type="submit" aria-label="搜索测评">
              <Search size={19} aria-hidden="true" />
            </button>
            <input
              type="search"
              name="q"
              aria-label="搜索测评名称或编号"
              placeholder="输入名称或编号，回车搜索"
              maxLength={80}
            />
          </form>
        )}
        {identity && (
          <Link
            href="/studio/session"
            prefetch={false}
            className={styles.topIdentity}
            aria-label="查看当前运营身份"
            title={identity.label}
          >
            <span className={styles.roleBadge}>{roleLabel(identity.role)}</span>
            <span className={styles.topAvatar} aria-hidden="true">
              {Array.from(identity.label.trim() || "Q")[0]?.toUpperCase()}
            </span>
          </Link>
        )}
      </div>
    </header>
  );
}
