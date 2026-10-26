import type { ReactNode } from "react";
import { LockKeyhole, ShieldCheck, Users } from "lucide-react";
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
          <span className={styles.mark}>Q</span>
          <div>
            <strong>QuizForge Studio</strong>
            <span>运营管理空间</span>
          </div>
        </div>
        <div className={styles.hero}>
          <h2>
            为好内容，
            <br />
            留出更从容的运营空间。
          </h2>
          <p>
            作品管理、清晰的角色分工与安全的账号访问，统一于一个简洁、专业的后台。
          </p>
          <div className={styles.art} aria-hidden="true">
            {[
              { Icon: Users, label: "成员与权限管理" },
              { Icon: ShieldCheck, label: "角色分工清晰" },
              { Icon: LockKeyhole, label: "账号与操作安全" },
            ].map(({ Icon, label }) => (
              <div key={label}>
                <Icon size={20} />
                <strong>{label}</strong>
                <i />
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
        </div>
      </main>
    </div>
  );
}
