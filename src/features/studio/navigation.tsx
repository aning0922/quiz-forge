"use client";
import { roleLabel } from "./accounts/presentation";
import { roleHasCapability } from "@/lib/auth/role-policy";

import { Fragment, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardList,
  Ticket,
  Settings,
  X,
  Users,
  History,
} from "lucide-react";
import { StudioBrand } from "./brand";
import {
  STUDIO_SECTIONS,
  studioLocation,
  type StudioIdentity,
} from "./navigation-model";
import { useStudioMobileNavigation } from "./mobile-navigation";
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
  const { registerDialog, id, close, closed } = useStudioMobileNavigation();
  function followedLink(event: MouseEvent<HTMLAnchorElement>) {
    if (
      !event.defaultPrevented &&
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey
    )
      close();
  }
  return (
    <aside className={styles.sidebar}>
      <dialog
        ref={registerDialog}
        id={id}
        className={styles.navigationDialog}
        open
        aria-label="Studio 导航菜单"
        onClose={closed}
        onClick={(event) => {
          if (
            event.target !== event.currentTarget ||
            !event.currentTarget.matches(":modal")
          )
            return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            close();
        }}
      >
        <div className={styles.drawerHeading}>
          <StudioBrand />
          <button
            className={styles.drawerClose}
            type="button"
            data-navigation-close
            onClick={close}
            aria-label="关闭 Studio 导航"
          >
            <X size={22} aria-hidden="true" />
          </button>
        </div>
        <nav className={styles.navigation} aria-label="Studio 导航">
          <p className={styles.sideLabel}>日常运营</p>
          {STUDIO_SECTIONS.map((item) => {
            const Icon = icons[item.id];
            return (
              <Fragment key={item.id}>
                {item.id === "settings" && (
                  <p className={styles.sideLabel}>平台管理</p>
                )}
                <Link
                  href={item.href}
                  prefetch={false}
                  aria-current={
                    location.section === item.id ? "page" : undefined
                  }
                  className={styles.navigationLink}
                  onClick={followedLink}
                >
                  <Icon size={20} aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              </Fragment>
            );
          })}
          {roleHasCapability(identity?.role, "account:manage") && (
            <Link
              href="/studio/accounts"
              prefetch={false}
              className={`${styles.accountNavigationLink} ${pathname === "/studio/accounts" ? styles.accountNavigationActive : ""}`}
              aria-current={
                pathname === "/studio/accounts" ? "page" : undefined
              }
              onClick={followedLink}
            >
              <Users size={19} aria-hidden="true" />
              <span>账号与权限</span>
            </Link>
          )}
          {roleHasCapability(identity?.role, "account:audit") && (
            <Link
              href="/studio/accounts/audit"
              prefetch={false}
              className={`${styles.accountNavigationLink} ${pathname === "/studio/accounts/audit" ? styles.accountNavigationActive : ""}`}
              aria-current={
                pathname === "/studio/accounts/audit" ? "page" : undefined
              }
              onClick={followedLink}
            >
              <History size={19} aria-hidden="true" />
              <span>账号操作记录</span>
            </Link>
          )}
        </nav>
        <div className={styles.sideFooter}>
          <p className={styles.navigationNote}>
            内测运营环境
            <br />
            内容、版本与访问码按测评管理。
          </p>
          <Link
            className={styles.identityLink}
            href="/studio/session"
            prefetch={false}
            aria-label="我的账号"
            aria-current={pathname === "/studio/session" ? "page" : undefined}
            onClick={followedLink}
          >
            <span className={styles.avatar} aria-hidden="true">
              {Array.from(identity?.label.trim() || "Q")[0]?.toUpperCase()}
            </span>
            <span>
              {identity ? (
                <>
                  <strong>{identity.label}</strong>
                  <small>{roleLabel(identity.role)} · 我的账号</small>
                </>
              ) : (
                "我的账号"
              )}
            </span>
          </Link>
        </div>
      </dialog>
    </aside>
  );
}
