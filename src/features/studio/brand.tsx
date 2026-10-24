import { Sparkles } from "lucide-react";
import styles from "./studio.module.css";

export function StudioBrand() {
  return (
    <div className={styles.brand}>
      <span className={styles.brandMark} aria-hidden="true">
        <Sparkles size={21} />
      </span>
      <div>
        <strong>QuizForge Studio</strong>
        <span>运营管理空间</span>
      </div>
    </div>
  );
}
