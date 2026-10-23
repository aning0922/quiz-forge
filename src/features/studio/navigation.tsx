"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./studio.module.css";

const items = [
  { href: "/studio/products", label: "工作区", description: "商品与测评流程" },
  {
    href: "/studio/taxonomy",
    label: "类目与标签",
    description: "整理商品目录",
  },
  { href: "/studio", label: "身份与退出", description: "当前运营会话" },
] as const;

/** One native, keyboard-operable navigation. Opening it grants no authority. */
export function StudioNavigation() {
  const pathname = usePathname();
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
  return (
    <aside className={styles.sidebar}>
      <details ref={panel} className={styles.navigationPanel} open>
        <summary>Studio 导航</summary>
        <nav className={styles.navigation} aria-label="Studio 导航">
          {items.map((item) => {
            const current =
              item.href === "/studio/products"
                ? pathname === "/studio/new-product" ||
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/")
                : pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                aria-current={current ? "page" : undefined}
                className={styles.navigationLink}
                onClick={() => {
                  if (
                    !window.matchMedia("(min-width: 960px)").matches &&
                    panel.current
                  )
                    panel.current.open = false;
                }}
              >
                <span>{item.label}</span>
                <small>{item.description}</small>
              </Link>
            );
          })}
        </nav>
        <p className={styles.navigationNote}>
          从商品工作区进入导入、草稿、审核版本与发码。
        </p>
      </details>
    </aside>
  );
}
