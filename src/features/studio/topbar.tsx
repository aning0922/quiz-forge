"use client";
import { Search, Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { studioLocation } from "./navigation-model";
import styles from "./studio.module.css";
import { useStudioMobileNavigation } from "./mobile-navigation";

export function StudioTopbar() {
  const pathname = usePathname();
  const location = studioLocation(pathname);
  const account = [
    "/studio/accounts",
    "/studio/accounts/audit",
    "/studio/session",
    "/studio/settings",
  ].includes(pathname);
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
          <strong>Studio</strong>
          <span aria-hidden="true">/</span>
          <span>{location.title}</span>
        </div>
      </div>
      <div className={styles.topbarActions}>
        {!account && (
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
              placeholder="搜索测评，按 Enter 查看"
              maxLength={80}
            />
          </form>
        )}
        <span className={styles.environment}>内测运营</span>
      </div>
    </header>
  );
}
