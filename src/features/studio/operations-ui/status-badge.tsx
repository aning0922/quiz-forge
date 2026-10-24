import type { PresentationStatus } from "./presentation";
import styles from "./status-badge.module.css";

export function StatusBadge({ status }: { status: PresentationStatus }) {
  return (
    <span className={`${styles.badge} ${styles[status.tone]}`}>
      {status.label}
    </span>
  );
}
