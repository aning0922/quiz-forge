"use client";

import Link from "next/link";
import { FileText, Eye, ShieldCheck, Ticket } from "lucide-react";
const icons = {
  content: FileText,
  preview: Eye,
  review: ShieldCheck,
  testing: Ticket,
};
import { usePathname } from "next/navigation";
import { activeProductWorkspaceTab, productWorkspaceTabs } from "./navigation";
import styles from "./task-workspace.module.css";

export function ProductWorkspaceNav({ productId }: { productId: string }) {
  const active = activeProductWorkspaceTab(usePathname(), productId);
  return (
    <nav className={styles.tabs} aria-label="测评核心任务">
      {productWorkspaceTabs(productId).map((item) => {
        const Icon = icons[item.id];
        return (
          <Link
            key={item.id}
            href={item.href}
            className={active === item.id ? styles.activeTab : undefined}
            aria-current={active === item.id ? "page" : undefined}
          >
            <Icon size={18} aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
