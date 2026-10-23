import styles from "./studio.module.css";
import { StudioNavigation } from "./navigation";

/** Portable frame also used by browser captures; the server layout supplies
 * authenticated navigation presentation. This prop grants no write authority.
 */
export function StudioShell({
  children,
  authenticated = false,
}: {
  children: React.ReactNode;
  authenticated?: boolean;
}) {
  return (
    <div className={`${styles.shell} ${authenticated ? "" : styles.signedOut}`}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            QF
          </span>
          <span>
            QuizForge <span className={styles.brandSuffix}>Studio</span>
          </span>
        </div>
        <span className={styles.environment}>本机运营内测</span>
      </header>
      {authenticated && <StudioNavigation />}
      <main id="main" className={styles.main}>
        {children}
      </main>
    </div>
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
