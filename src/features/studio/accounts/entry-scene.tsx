import type { ReactNode } from "react";
import { LockKeyhole, ShieldCheck, Sparkles, Users } from "lucide-react";
import styles from "./entry.module.css";

export function EntryScene({
  kind,
  eyebrow,
  title,
  description,
  children,
}: {
  kind: "login" | "setup";
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.scene} data-studio-entry={kind}>
      <aside className={styles.side} aria-label="QuizForge Studio">
        <div className={styles.brand}>
          <span className={styles.mark}>
            <Sparkles size={23} aria-hidden="true" />
          </span>
          <div>
            <strong>QuizForge Studio</strong>
          </div>
        </div>
        <div className={styles.hero}>
          <h2>
            为好内容，
            <br />
            留出更从容的运营空间。
          </h2>
          <p>
            清晰的工作流、明确的角色分工与可信的操作记录，在一个完整的后台里协作。
          </p>
          <div className={styles.art} aria-hidden="true">
            {[
              { Icon: Users, label: "人员与权限管理" },
              { Icon: ShieldCheck, label: "角色边界清晰" },
              { Icon: LockKeyhole, label: "原操作及账号安全" },
            ].map(({ Icon, label }) => (
              <div key={label}>
                <Icon size={20} />
                <strong>{label}</strong>
              </div>
            ))}
          </div>
        </div>
        <p className={styles.sideFoot}>QUIZFORGE STUDIO · OPERATIONS</p>
      </aside>
      <main className={styles.main}>
        <div className={styles.inner}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1>{title}</h1>
          <p className={styles.description}>{description}</p>
          {children}
          <p className={styles.footnote}>
            运营人员专用空间
            <br />
            账号由管理员开通；不提供公开注册或消费者登录。
          </p>
        </div>
      </main>
    </div>
  );
}
