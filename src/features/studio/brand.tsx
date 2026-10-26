import { Sparkle } from "lucide-react";
import styles from "./studio.module.css";

export function StudioBrand() {
  return (
    <div className={styles.brand}>
      <span className={styles.brandMark} aria-hidden="true">
        <Sparkle size={21} />
      </span>
      <div>
        <strong>QuizForge</strong>
        <span>STUDIO / 工作空间</span>
      </div>
    </div>
  );
}
