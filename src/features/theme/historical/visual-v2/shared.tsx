import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import styles from "./visual-v2.module.css";

export type Direction = "journey" | "collection";
export const studyPath = (direction: Direction, view: string) =>
  `/studies/visual-v2/${direction}/${view}`;

export function StudyShell({
  direction,
  view,
  children,
  backHref,
}: {
  direction: Direction;
  view: string;
  children: React.ReactNode;
  backHref?: string;
}) {
  return (
    <main
      id="main"
      className={`${styles.shell} ${direction === "journey" ? styles.journey : styles.collection}`}
      data-direction={direction}
      data-view={view}
    >
      <header className={styles.header}>
        <Link
          prefetch={false}
          href={studyPath(direction, "cover")}
          className={styles.brand}
        >
          <span className={styles.brandSeal} aria-hidden="true">
            千
          </span>
          <span>
            千载同心<small>QUIZFORGE</small>
          </span>
        </Link>
        {view === "cover" ? (
          <span className={styles.meta}>合成体验</span>
        ) : (
          <Link
            prefetch={false}
            className={styles.back}
            href={
              backHref ??
              studyPath(direction, view === "poster" ? "report" : "cover")
            }
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {view === "poster" ? "返回报告" : "回到封面"}
          </Link>
        )}
      </header>
      {children}
      <footer className={styles.footer}>
        <span>娱乐与自我探索 · 非心理诊断</span>
        <span>视觉概念 / 素材待审</span>
      </footer>
    </main>
  );
}

export function PrimaryLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link prefetch={false} className={styles.primary} href={href}>
      {children}
      <ArrowUpRight size={20} aria-hidden="true" />
    </Link>
  );
}

export function CardBack() {
  return (
    <div
      className={styles.cardBack}
      aria-label="未开启的人物藏卡，不含人物身份"
    >
      <div className={styles.cardBackInner}>
        <span className={styles.meta}>千载同心 · 人物藏卡</span>
        <div className={styles.cardEmblem} aria-hidden="true">
          <span>
            风<br />骨
          </span>
        </div>
        <p>藏在选择里的你</p>
        <span className={styles.cardBackFoot}>十二问 · 待启</span>
      </div>
    </div>
  );
}
