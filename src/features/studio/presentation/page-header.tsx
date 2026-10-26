import type { ReactNode } from "react";
import styles from "./presentation.module.css";

export function StudioPageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <div>
        {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <div className={styles.description}>{description}</div>}
      </div>
      {actions && <div className={styles.headerActions}>{actions}</div>}
    </header>
  );
}
