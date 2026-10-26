"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { roleHasCapability, type StudioRole } from "@/lib/auth/role-policy";
import styles from "./experience.module.css";

/** Route links share the shell's leave protection and keep the task owner intact. */
export function AccountWorkspaceNav({ role }: { role: StudioRole }) {
  const pathname = usePathname();
  const canManage = roleHasCapability(role, "account:manage");
  return (
    <nav className={styles.tabs} aria-label="账号工作区">
      {[
        { href: "/studio/accounts", label: "账号与权限" },
        { href: "/studio/accounts/audit", label: "账号操作记录" },
        { href: "/studio/session", label: "我的账号" },
      ]
        .filter((item) => canManage || item.href === "/studio/session")
        .map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={pathname === item.href ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
    </nav>
  );
}
