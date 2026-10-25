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
}: {
  children: React.ReactNode;
  authenticated?: boolean;
  identity?: StudioIdentity | undefined;
}) {
  return (
    <StudioNavigationBoundary>
      <StudioMobileNavigation>
        <div
          className={`${styles.shell} ${authenticated ? "" : styles.signedOut}`}
        >
          {authenticated && <StudioNavigation identity={identity} />}
          <div className={styles.content}>
            <header className={styles.publicHeader}>
              <StudioBrand />
            </header>
            {authenticated && <StudioTopbar identity={identity} />}
            <main id="main" className={styles.main}>
              {children}
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
