import styles from "./studio.module.css";

export function StudioShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.brand}>QuizForge Studio</span>
        <span className={styles.environment}>本机运营内测 · P2-A</span>
      </header>
      <main id="main" className={styles.main}>
        {children}
      </main>
    </div>
  );
}

export function StudioUnavailable() {
  return (
    <section className={styles.panel}>
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
