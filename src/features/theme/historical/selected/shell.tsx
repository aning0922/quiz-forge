import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { selectedHistoricalStyle } from "./tokens";
import styles from "./selected.module.css";

export function SelectedHistoricalShell({
  children,
  state,
}: {
  children: React.ReactNode;
  state: "cover" | "result";
}) {
  return (
    <main id="main" className={styles.shell} style={selectedHistoricalStyle}>
      <div className={styles.reviewBar}>
        <Link href="/studies/historical">
          <ArrowLeft size={15} aria-hidden="true" /> 研究留档
        </Link>
        <span>D1-A.1 · 定向预览</span>
      </div>
      <header className={styles.header}>
        <Link
          href="/studies/historical/selected/cover"
          className={styles.wordmark}
        >
          千载同心<span>QUIZFORGE</span>
        </Link>
        <span>人物志 / {state === "cover" ? "未揭晓" : "合成结果"}</span>
      </header>
      {children}
      <footer className={styles.footer}>
        <span>QUIZFORGE · 东方人物志</span>
        <Link href="/studies/historical">
          查看研究原型 <ArrowRight size={15} aria-hidden="true" />
        </Link>
        <p>静态研发预览 · 素材待审 · 非已发布商品</p>
      </footer>
    </main>
  );
}
