"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeProductWorkspaceTab, productWorkspaceTabs } from "./navigation";
import styles from "./workspace.module.css";

export function ProductWorkspaceNav({ productId }: { productId: string }) {
  const active = activeProductWorkspaceTab(usePathname(), productId);
  return (
    <nav className={styles.tabs} aria-label="测评业务导航">
      {productWorkspaceTabs(productId).map((item) => (
        <Link
          key={item.id}
          href={item.href}
          aria-current={active === item.id ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
