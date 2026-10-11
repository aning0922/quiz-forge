import Link from "next/link";
import { ArrowRight, Bookmark } from "lucide-react";
import { CandidateImage } from "./image";
import styles from "./candidate.module.css";

export function CabinetCover() {
  return (
    <main id="main" className={styles.cover} data-v2c="cover">
      <header className={styles.header}>
        <span>千载同心</span>
        <small>一程探寻 · 十二问</small>
      </header>
      <div className={styles.coverStage}>
        <div className={styles.coverScene}>
          <CandidateImage
            asset="room-1"
            eager
            sizes="(min-width: 900px) 640px, 100vw"
            alt="青玉拱门与层层展厅，晨光落在无字藏册和铜灯旁。"
          />
          <p className={styles.coverInscription}>入藏馆 · 寻同心</p>
        </div>
        <section className={styles.coverCopy}>
          <p className={styles.kicker}>藏馆探寻 / A JOURNEY WITHIN</p>
          <h1>
            你的性格，
            <br />
            历史上最像谁？
          </h1>
          <p className={styles.coverLead}>
            循着十二个日常选择，
            <br />
            走进一座收藏性情的藏馆。
          </p>
          <div className={styles.coverChapters} aria-label="四厅路线">
            <span>起念</span>
            <i />
            <span>观心</span>
            <i />
            <span>照影</span>
            <i />
            <span>留记</span>
          </div>
          <Link
            href="/studies/visual-v2-c/question"
            prefetch={false}
            className={styles.primary}
          >
            推门入馆 <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <p className={styles.saveHint}>
            <Bookmark size={14} aria-hidden="true" />
            支持本机暂存，可接着答
          </p>
          <p className={styles.coverDisclosure}>
            研究体验：完成后展示固定合成报告，与本次作答无关。娱乐性格测评，非心理诊断。
          </p>
        </section>
      </div>
    </main>
  );
}
