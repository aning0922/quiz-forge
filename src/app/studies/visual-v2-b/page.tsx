import Link from "next/link";
import { ArtImage } from "@/features/theme/historical/visual-v2-b/art-image";
import {
  artDirections,
  artPath,
  artRecipes,
  type ArtView,
} from "@/features/theme/historical/visual-v2-b/art-direction";
import styles from "@/features/theme/historical/visual-v2-b/art-study.module.css";

export const metadata = { title: "Visual V2-B · 结果美术研究" };

export default function ArtStudyIndex() {
  return (
    <main id="main" className={styles.research}>
      <header>
        <Link href="/studies/visual-v2">← V2-A / A.1 比较基线</Link>
        <span>VISUAL V2-B · 美术研究</span>
      </header>
      <h1>让人物，成为相逢的理由。</h1>
      <p>
        两幅原创概念画、两种艺术语言。本轮只探索结果揭晓、报告主视觉与性情图谱的衔接、收藏画作；不改动既有十二题体验。
      </p>
      <p>
        固定李白合成示例，五维数值仍为88 / 82 / 64 / 46 /
        38，不来自答案。图像为本轮实际生成的AI概念，商用与内容审核pending。没有真实匹配、动态选诗、海报导出或正式发布。
      </p>
      <div className={styles.studyGrid}>
        {artDirections.map((direction, index) => {
          const recipe = artRecipes[direction];
          return (
            <section className={styles.studyDirection} key={direction}>
              <ArtImage src={recipe.src} alt={recipe.alt} />
              <h2>
                {index + 1}. {recipe.title}
              </h2>
              <p>{recipe.subtitle}</p>
              <p>
                {direction === "landscape"
                  ? "人物立于山河之间，以晨光、岩台、松风和远帆形成开放的行路情境。姓名与诗句落入画境，性情文字沿长卷继续。"
                  : "近景人物、玉杯与月轮建立鲜明焦点；织物、夜色和克制的金纹构成一张完整的收藏图鉴。"}
              </p>
              <nav aria-label={`${recipe.title}研究入口`}>
                {(
                  [
                    ["reveal", "人物揭晓"],
                    ["report", "报告与图谱"],
                    ["poster", "收藏画作"],
                  ] as const
                ).map(([view, label]) => (
                  <Link
                    key={view}
                    href={artPath(direction, view as ArtView)}
                    prefetch={false}
                  >
                    {label}
                  </Link>
                ))}
                <Link
                  href={`/studies/visual-v2/${recipe.baseline}/reveal`}
                  prefetch={false}
                >
                  旧版揭晓对照
                </Link>
              </nav>
            </section>
          );
        })}
      </div>
      <section className={styles.researchNote}>
        <p>
          压力样例只验证排版，不代表新增人物、正式评分或动态匹配。两个方向使用相同展示DTO，旧版页面与截图完整保留。
        </p>
        <nav aria-label="专项排版研究">
          {artDirections.map((direction) => (
            <Link
              key={direction}
              href={artPath(direction, "poster", "?sample=long")}
              prefetch={false}
            >
              {artRecipes[direction].title} · 长文字
            </Link>
          ))}
          <Link
            href={artPath("landscape", "report", "?inscription=original")}
            prefetch={false}
          >
            原创题签
          </Link>
          <Link
            href={artPath("celestial", "report", "?inscription=none")}
            prefetch={false}
          >
            不显示题签
          </Link>
        </nav>
      </section>
    </main>
  );
}
