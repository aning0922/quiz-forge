"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardList,
  Ticket,
  Settings,
  UserRound,
} from "lucide-react";
import { StudioBrand } from "./brand";
import {
  STUDIO_SECTIONS,
  studioLocation,
  type StudioIdentity,
} from "./navigation-model";
import styles from "./studio.module.css";

const icons = {
  dashboard: LayoutDashboard,
  products: ClipboardList,
  testing: Ticket,
  settings: Settings,
};

export function StudioNavigation({
  identity,
}: {
  identity?: StudioIdentity | undefined;
}) {
  const pathname = usePathname(),
    location = studioLocation(pathname);
  const panel = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 960px)");
    if (panel.current) panel.current.open = desktop.matches;
    const showDesktop = () => {
      if (desktop.matches && panel.current) panel.current.open = true;
    };
    desktop.addEventListener("change", showDesktop);
    return () => desktop.removeEventListener("change", showDesktop);
  }, []);
  const closeMobile = () => {
    if (!window.matchMedia("(min-width: 960px)").matches && panel.current)
      panel.current.open = false;
  };
  return (
    <aside className={styles.sidebar}>
      <StudioBrand />
      <details ref={panel} className={styles.navigationPanel} open>
        <summary>Studio 导航</summary>
        <nav className={styles.navigation} aria-label="Studio 导航">
          <p className={styles.sideLabel}>日常运营</p>
          {STUDIO_SECTIONS.map((item) => {
            const Icon = icons[item.id];
            return (
              <Link
                key={item.id}
                href={item.href}
                prefetch={false}
                aria-current={location.section === item.id ? "page" : undefined}
                className={styles.navigationLink}
                onClick={closeMobile}
              >
                <Icon size={21} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className={styles.sideFooter}>
          <p className={styles.navigationNote}>
            内测运营环境
            <br />
            按测评管理内容、版本与访问码。
          </p>
          <Link
            className={styles.identityLink}
            href="/studio/session"
            prefetch={false}
            aria-label="身份与退出"
            aria-current={pathname === "/studio/session" ? "page" : undefined}
            onClick={closeMobile}
          >
            <UserRound size={23} aria-hidden="true" />
            <span>
              {identity ? (
                <>
                  <strong>{identity.label}</strong>
                  <small>
                    {identity.role === "operator" ? "运营者" : "只读身份"} ·
                    身份与退出
                  </small>
                </>
              ) : (
                "身份与退出"
              )}
            </span>
          </Link>
        </div>
      </details>
    </aside>
  );
}
