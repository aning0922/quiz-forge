import type { ReactNode } from "react";
import styles from "./presentation.module.css";

/** Only support information belongs here; pending recovery stays visible outside. */
export function TechnicalDetails({
  children,
  label = "技术信息",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <details className={styles.technical}>
      <summary>{label}</summary>
      <div>{children}</div>
    </details>
  );
}
