"use client";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { StudioAccountOwner } from "./accounts/session-owner";
import { SidebarLogoutAction } from "./accounts/sidebar-logout-action";
import type { StudioSessionDto } from "./contracts";
import styles from "./studio.module.css";
import { StudioNavigation } from "./navigation";
import { StudioMobileNavigation } from "./mobile-navigation";
import { StudioTopbar } from "./topbar";
import { StudioBrand } from "./brand";
import { StudioNavigationBoundary } from "./navigation-boundary";
import type { StudioIdentity } from "./navigation-model";

/** Portable frame also used by browser captures; the server layout supplies
 * authenticated navigation presentation. This prop grants no write authority.
 */
export function StudioShell({
  children,
  authenticated = false,
  identity,
  session,
}: {
  children: React.ReactNode;
  authenticated?: boolean;
  identity?: StudioIdentity | undefined;
  session?: StudioSessionDto | undefined;
}) {
  const pathname = usePathname();
  const [recoveredSession, setRecoveredSession] = useState<StudioSessionDto>();
  const liveIdentity = recoveredSession
    ? {
        label: recoveredSession.operator.displayName,
        role: recoveredSession.operator.role,
      }
    : identity;
  const entry =
    pathname === "/studio/login" || pathname === "/studio/set-password";
  if (entry)
    return (
      <StudioNavigationBoundary>
        <main className={styles.entryRoot}>{children}</main>
      </StudioNavigationBoundary>
    );
  return (
    <StudioNavigationBoundary>
      <StudioMobileNavigation>
        <div
          className={`${styles.shell} ${authenticated ? "" : styles.signedOut}`}
        >
          {authenticated && <StudioNavigation identity={liveIdentity} />}
          <div className={styles.content}>
            <header className={styles.publicHeader}>
              <StudioBrand />
            </header>
            {authenticated && <StudioTopbar />}
            <main
              id="main"
              className={styles.main}
              data-workspace={
                pathname.startsWith("/studio/products/") || undefined
              }
            >
              {session ? (
                <StudioAccountOwner
                  initialSession={session}
                  onSessionChange={setRecoveredSession}
                >
                  <SidebarLogoutAction session={session} />
                  {children}
                </StudioAccountOwner>
              ) : (
                children
              )}
            </main>
          </div>
        </div>
      </StudioMobileNavigation>
    </StudioNavigationBoundary>
  );
}

export function StudioUnavailable() {
  return (
    <section className={styles.panel} data-studio-entry="unavailable">
      <h1>Studio 暂不可用</h1>
      <p className={styles.intro}>
        本地运营环境的配置或数据库尚未就绪。本页没有建立登录会话。
      </p>
      <p className={styles.note}>
        请由本机维护者检查专属 P2-A
        环境后重新打开。消费者测评访问凭证与运营身份分别管理。
      </p>
    </section>
  );
}
