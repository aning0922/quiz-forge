import styles from "./historical.module.css";

/** Original decorations only; never substitute for a character asset. */
export function Seal({ children }: { children: React.ReactNode }) {
  return (
    <span className={styles.seal} aria-hidden="true">
      {children}
    </span>
  );
}

export function ScrollRule() {
  return (
    <div className={styles.scrollRule} aria-hidden="true">
      <span />◇<span />
    </div>
  );
}

export function CloudOrnament() {
  return (
    <svg
      className={styles.cloud}
      viewBox="0 0 220 60"
      fill="none"
      aria-hidden="true"
    >
      <path d="M2 44h49c-17 0-25-8-25-17 0-11 16-14 22-6 6-22 39-21 44-2 12-13 33-6 32 9h48c26 0 39 12 44 23H98c-15 0-20-11-10-16 8-4 14 3 8 7H56" />
      <path d="M35 54h116M136 15h33c-7-15-31-17-41-3" />
    </svg>
  );
}
