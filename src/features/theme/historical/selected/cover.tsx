import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { historicalAssets } from "../tokens";
import { Seal, ScrollRule } from "../ornaments";
import { SelectedHistoricalShell } from "./shell";
import styles from "./selected.module.css";

/** No report/identity props: unrevealed pages do not receive a result payload. */
export function SelectedHistoricalCover() {
  return (
    <SelectedHistoricalShell state="cover">
      <div className={styles.coverLayout}>
        <section
          className={styles.neutralCover}
          aria-label="未揭晓的山水情境封面"
        >
          <div
            className={styles.landscape}
            style={{ backgroundImage: `url(${historicalAssets.landscape})` }}
            aria-hidden="true"
          />
          <div className={styles.coverTitle}>
            <p className={styles.kicker}>千载同心 · 历史人物匹配</p>
            <h1>
              你的性格，
              <br />
              历史上最像谁？
            </h1>
            <p>在千年风骨里，遇见另一种自己。</p>
          </div>
          <div className={styles.journey} aria-hidden="true">
            <span>山河入梦</span>
            <i />
            <span>寻古知己</span>
          </div>
          <div className={styles.neutralSignature}>
            <Seal>
              寻<br />古
            </Seal>
            <p>
              一卷山河，
              <br />
              等你写下自己的性情。
            </p>
          </div>
          <span className={styles.sceneNote}>中性情境视觉 · 人物尚未揭晓</span>
        </section>
        <div className={styles.coverIntro}>
          <ScrollRule />
          <p className={styles.invitation}>先遇见自己，再与千年风骨相逢。</p>
          <Link
            className={styles.primaryLink}
            href="/studies/historical/selected/result"
          >
            查看合成结果构图 <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <p className={styles.note}>
            研究入口，不代表答题或完成测评。
            <br />
            娱乐性格测评，不作为心理诊断。
          </p>
          <section className={styles.coverEssay}>
            <p className={styles.kicker}>一段关于性情的探索</p>
            <h2>
              山河作序，
              <br />
              人物为你而来。
            </h2>
            <p>
              从宣纸与山水开始，沿着清晰、安静的阅读节奏，寻找属于你的表达。具体人物会在结果揭晓时出现；封面不预设你的答案。
            </p>
            <p className={styles.note}>
              本轮只验证视觉与展示槽位。答题、书签暂存及真实人物匹配尚未开放。
            </p>
          </section>
        </div>
      </div>
    </SelectedHistoricalShell>
  );
}
