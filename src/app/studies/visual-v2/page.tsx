import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import {
  studyPath,
  type Direction,
} from "@/features/theme/historical/visual-v2/shared";
import styles from "@/features/theme/historical/visual-v2/visual-v2.module.css";

export const metadata = { title: "Visual V2 · 双方向设计研究" };
const directions: {
  id: Direction;
  code: string;
  name: string;
  subtitle: string;
  description: string;
}[] = [
  {
    id: "journey",
    code: "A",
    name: "入画寻己",
    subtitle: "现代国风互动叙事",
    description:
      "走入青绿山水，以十二道情境写下一程心事。宽幅题面、留白与章节节奏，让轻松答题通向一份可慢慢读的人物志。",
  },
  {
    id: "collection",
    code: "B",
    name: "风骨藏馆",
    subtitle: "精致国风角色收藏",
    description:
      "从一张未开启的藏卡出发，以十二枚问笺收集性情线索。深青展柜、暖金字序与完整角色卡，强调揭晓和收藏的期待。",
  },
];
export default function VisualStudyIndex() {
  return (
    <main id="main" className={styles.research}>
      <header>
        <Link href="/studies/historical">← 历史研究留档</Link>
        <span>VISUAL V2-A / 设计研究</span>
      </header>
      <p className={styles.eyebrow}>千载同心 · 消费者体验重设计</p>
      <h1>
        一种性情，
        <br />
        两种相逢。
      </h1>
      <p className={styles.researchLead}>先走完旅程，再选择它的模样。</p>
      <div className={styles.researchNotice}>
        <strong>合成研究原型，尚未发布</strong>
        <p>
          两方案共用现有12题，各自保留本机进度。揭晓均为固定李白示例，不根据答案评分；海报为视觉概念，无导出、正式结果存储或交易功能。AI美术与内容仍待人工审核及商用证据补齐。
        </p>
      </div>
      <div className={styles.directions}>
        {directions.map((d) => (
          <section
            key={d.id}
            className={
              d.id === "journey"
                ? styles.directionJourney
                : styles.directionCollection
            }
          >
            <div className={styles.directionScene}>
              <span>{d.code}</span>
              <h2>{d.name}</h2>
              <p>{d.subtitle}</p>
            </div>
            <div className={styles.directionInfo}>
              <p>{d.description}</p>
              <Link
                className={styles.researchCta}
                href={studyPath(d.id, "cover")}
                prefetch={false}
              >
                完整体验 {d.code}
                <ArrowUpRight size={20} />
              </Link>
              <nav aria-label={`${d.name}研究状态入口`}>
                {[
                  ["cover", "封面"],
                  ["question", "答题"],
                  ["reveal", "揭晓"],
                  ["report", "报告"],
                  ["poster", "海报"],
                ].map(([view, label]) => (
                  <Link
                    prefetch={false}
                    key={view}
                    href={studyPath(d.id, view!)}
                  >
                    {label}
                  </Link>
                ))}
              </nav>
            </div>
          </section>
        ))}
      </div>
      <section className={styles.researchDecision}>
        <h2>本轮推荐：A 作为主体验候选</h2>
        <p>
          A 更适合低门槛的轻测评与长报告阅读；B
          更强调人物卡的收藏吸引力，也更依赖后续成套角色美术。请比较手机上的封面好奇心、连续12题的负担、报告查阅和海报收藏意愿。此处是设计判断，未经转化率验证。
        </p>
        <p>等待作者选择方向后再冻结设计。本轮不推进 D1-C。</p>
      </section>
    </main>
  );
}
