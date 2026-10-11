import Link from "next/link";
import { ArrowRight, MoveUpRight } from "lucide-react";
import { CoverArtwork, studyStyle } from "./prototype";
import { historicalStudies, directions } from "./tokens";
import styles from "./historical.module.css";

export function HistoricalExploration() {
  return (
    <main id="main" className={styles.exploration}>
      <header className={styles.explorationHeader}>
        <Link href="/" className={styles.labBrand}>
          QuizForge<span>VISUAL ATELIER</span>
        </Link>
        <span>D1-A / 历史人物视觉研发</span>
      </header>
      <aside className={styles.selectedDecision}>
        <div>
          <span>D1-A.1 / 作者已定向</span>
          <p>
            东方人物志为主，青金用于揭晓与收藏。以下原型作为研究留档，含李白示例的封面不用于消费者页面。
          </p>
        </div>
        <Link href="/studies/historical/selected/cover">
          查看统一视觉预览 <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </aside>
      <div className={styles.explorationIntro}>
        <p className={styles.kicker}>FIRST COLLECTION · 千载同心</p>
        <h1>
          与千年的风骨，
          <br />
          <em>相逢。</em>
        </h1>
        <div>
          <p>
            《你的性格，历史上最像谁？》
            <br />
            两种新中式视觉方向，同一位概念人物。
            <br />
            从一卷人物志，到一张值得收藏的角色卡。
          </p>
          <span className={styles.reviewBadge}>D1-A 原始研究 · 留档</span>
        </div>
      </div>
      <section className={styles.directions} aria-label="两个视觉方向">
        {directions.map((direction) => {
          const t = historicalStudies[direction];
          return (
            <article key={direction} className={styles.directionCard}>
              <div className={styles.directionHeading}>
                <span>
                  {t.number} / {t.label}
                </span>
                <h2>{t.name}</h2>
                <p>
                  {direction === "folio"
                    ? "宣纸长卷 · 青绿山水 · 典雅留白"
                    : "青金舞台 · 精细立绘 · 收藏仪式"}
                </p>
              </div>
              <Link
                href={`/studies/historical/${direction}/cover`}
                className={`${styles.previewLink} ${styles[direction]}`}
                style={studyStyle(direction)}
                aria-label={`查看${t.name}封面概念`}
              >
                <CoverArtwork direction={direction} compact />
              </Link>
              <div className={styles.directionLinks}>
                <Link href={`/studies/historical/${direction}/cover`}>
                  封面概念 <MoveUpRight size={17} aria-hidden="true" />
                </Link>
                <Link href={`/studies/historical/${direction}/portrait`}>
                  人物档案概念 <ArrowRight size={17} aria-hidden="true" />
                </Link>
              </div>
              <p className={styles.directionDescription}>
                {direction === "folio"
                  ? "人物与山水共同展开。留白为标题让路，朱砂成为落点；档案延续横排长卷，适合文化叙事与耐心阅读。"
                  : "深青衬托米白衣袍，金框收拢视觉。人物卡有更强的揭晓感；长篇解读离开卡框，回到独立的浅色阅读面。"}
              </p>
            </article>
          );
        })}
      </section>
      <section className={styles.comparison}>
        <p className={styles.kicker}>DESIGN NOTES / 取舍</p>
        <h2>两种气质，一样清晰的阅读。</h2>
        <div className={styles.comparisonGrid}>
          <article>
            <span>01 / 东方人物志</span>
            <h3>更适合慢慢展开的故事</h3>
            <p>
              封面冲击力来自山水和偏轴人物，阅读舒适度高；结果页像一卷人物专刊。素材更易跨状态复用，实现成本相对低，但需要谨慎控制山水浓度和人物裁切。
            </p>
          </article>
          <article>
            <span>02 / 青金藏品卡</span>
            <h3>更适合一次郑重的揭晓</h3>
            <p>
              深浅反差与完整卡框强化封面冲击力，结果收藏感更强。长文另设浅色底面；多画幅卡框与人物裁切的适配成本相对高，适合复用到小型收藏系列。
            </p>
          </article>
        </div>
      </section>
      <aside className={styles.scope}>
        <span>D1-A 边界</span>
        <p>
          当前是静态高保真视觉研究，人物档案为合成文案。没有答题、评分、保存或海报导出。AI
          概念立绘与背景均待审核。作者已确认folio主方向与cabinet揭晓语言；本页保留原始比较，后续以统一预览为准，D1-B另需明确授权。
        </p>
      </aside>
      <footer className={styles.explorationFooter}>
        <span>QUIZFORGE / 2026</span>
        <Link href="/themes/historical">
          D0 历史人物方向简报 <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </footer>
    </main>
  );
}
