import { Character } from "./character";
import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowLeft, ArrowRight, MoveUpRight } from "lucide-react";
import {
  historicalAssets,
  historicalStudies,
  type HistoricalDirection,
  type HistoricalStudyState,
} from "./tokens";
import { CloudOrnament, ScrollRule, Seal } from "./ornaments";
import styles from "./historical.module.css";

export function studyStyle(direction: HistoricalDirection): CSSProperties {
  const t = historicalStudies[direction];
  return {
    "--h-surface": t.surface,
    "--h-ink": t.ink,
    "--h-muted": t.muted,
    "--h-accent": t.accent,
    "--h-jade": t.jade,
    "--h-gold": t.gold,
  } as CSSProperties;
}

function Landscape() {
  return (
    <div
      className={styles.landscape}
      style={{ backgroundImage: `url(${historicalAssets.landscape})` }}
      aria-hidden="true"
    />
  );
}

export function CoverArtwork({
  direction,
  compact = false,
}: {
  direction: HistoricalDirection;
  compact?: boolean;
}) {
  const folio = direction === "folio";
  const Title = compact ? "h3" : "h1";
  return (
    <div
      className={`${styles.coverArtwork} ${folio ? styles.folioCover : styles.cabinetCover} ${compact ? styles.compact : ""}`}
    >
      {folio ? (
        <>
          <Landscape />

          <div className={styles.coverTitle}>
            <p className={styles.kicker}>千载同心 · 历史人物匹配</p>
            <Title>
              你的性格，
              <br />
              历史上最像谁？
            </Title>
            <p className={styles.subtitle}>在千年风骨里，遇见另一种自己。</p>
          </div>
          <span className={styles.verticalPoem} aria-hidden="true">
            山河有故人
            <br />
            风骨照此心
          </span>
          <Character />
          <div className={styles.coverSignature}>
            <Seal>
              知<br />己
            </Seal>
            <span>卷一 · 寻古</span>
          </div>
          <span className={styles.characterCaption}>李白 · 概念角色</span>
        </>
      ) : (
        <>
          <div className={styles.coverTitle}>
            <p className={styles.kicker}>千载同心 / 人物收藏计划</p>
            <Title>
              你的性格，
              <br />
              历史上最像谁？
            </Title>
          </div>
          <div className={styles.collectionStage}>
            <div className={styles.moon} aria-hidden="true" />
            <CloudOrnament />
            <span className={styles.collectionIndex}>
              卷壹
              <br />
              <b>风骨</b>
            </span>
            <Character />
            <span className={styles.collectionName}>李白</span>
            <div className={styles.cardCaption}>
              <span>浪漫 · 自由 · 行路</span>
              <span>盛唐诗人 / 概念角色</span>
            </div>
          </div>
          <p className={styles.cabinetTagline}>千年之外，另一种我。</p>
        </>
      )}
    </div>
  );
}

function Cover({ direction }: { direction: HistoricalDirection }) {
  return (
    <>
      <CoverArtwork direction={direction} />
      <div className={styles.coverBottom}>
        <ScrollRule />
        <p>一次关于性情的想象，一卷属于你的风骨。</p>
        <Link
          className={styles.primaryLink}
          href={`/studies/historical/${direction}/portrait`}
        >
          翻开人物档案概念 <ArrowRight size={19} aria-hidden="true" />
        </Link>
        <span className={styles.disclaimer}>
          娱乐性格测评 · 当前仅为视觉原型，未开放答题
        </span>
      </div>
      <section className={styles.intent}>
        <p className={styles.kicker}>关于这次相遇</p>
        <h2>
          以古人的风骨，
          <br />
          映照当下的性情。
        </h2>
        <p>
          我们借历史人物的文化意象，讨论自由、创造与人与人的连接。它是一种趣味表达，不是心理诊断，也不替你定义人生。
        </p>
        <Link href="/studies/historical">
          比较两种视觉方向 <MoveUpRight size={16} aria-hidden="true" />
        </Link>
      </section>
    </>
  );
}

function Portrait({ direction }: { direction: HistoricalDirection }) {
  const folio = direction === "folio";
  return (
    <>
      <div
        className={`${styles.portraitHero} ${folio ? styles.folioPortrait : styles.cabinetPortrait}`}
      >
        {folio && <Landscape />}
        <p className={styles.kicker}>人物档案 · 合成示例 / 非测评结果</p>
        <div className={styles.portraitArt}>
          {!folio && <div className={styles.moon} aria-hidden="true" />}
          <Character />
          <div className={styles.portraitIdentity}>
            <span>盛唐 · 诗人</span>
            <h1>李白</h1>
            <Seal>
              浪<br />漫
            </Seal>
          </div>
          <span className={styles.portraitSerial}>风骨卷 / 壹</span>
        </div>
        <div className={styles.portraitHeadline}>
          <p>浪漫自由的行路者</p>
          <h2>
            将心事，
            <br />
            写成远方。
          </h2>
        </div>
      </div>
      <div className={styles.reading}>
        <div className={styles.readingMeta}>
          <span>性情解读 / 展示文案</span>
          <span>01 — 03</span>
        </div>
        <p className={styles.lead}>
          你珍视自由，也愿意为心中的热爱，走一条少有人走的路。
        </p>
        <div className={styles.traits}>
          <span>独立而坦率</span>
          <span>灵感先行</span>
          <span>向往远方</span>
        </div>
        <ScrollRule />
        <section className={styles.chapter}>
          <span>壹</span>
          <div>
            <h3>以诗意回应世界</h3>
            <p>
              面对平淡的日常，你常能发现值得停留的细节。你愿意表达感受，也期待和能理解你的人交换想法。热情有时来得很快；给它一点落地的时间，会让创意走得更远。
            </p>
          </div>
        </section>
        <section className={styles.chapter}>
          <span>贰</span>
          <div>
            <h3>自由，也需要自己的节奏</h3>
            <p>
              喜欢新的可能，不意味着必须一直出发。你可以为重要的关系保留回应，为长久的目标留一点耐心。允许自己放慢脚步，依然是一种主动的选择。
            </p>
          </div>
        </section>
        <aside className={styles.culture}>
          <p className={styles.kicker}>文化意象 · 与性格解释分开</p>
          <h3>为什么用李白作为概念角色？</h3>
          <p>
            此处借“诗人、行路与自由”的文化意象探索视觉表达。以上文案完全为布局编写，未由任何答题或算法产生，也不代表对真实历史人物性格的定论。
          </p>
        </aside>
        <p className={styles.disclaimer}>
          娱乐与自我探索，不作为心理诊断。
          <br />
          人物为艺术化演绎；素材及视觉方向待作者审核。
        </p>
        <Link
          className={styles.outlineLink}
          href={`/studies/historical/${direction}/cover`}
        >
          <ArrowLeft size={17} aria-hidden="true" /> 返回封面概念
        </Link>
      </div>
    </>
  );
}

export function HistoricalPrototype({
  direction,
  state,
}: {
  direction: HistoricalDirection;
  state: HistoricalStudyState;
}) {
  const t = historicalStudies[direction];
  return (
    <main
      id="main"
      className={`${styles.prototype} ${styles[direction]}`}
      style={studyStyle(direction)}
    >
      <div className={styles.researchBar}>
        <Link href="/studies/historical">
          <ArrowLeft size={15} aria-hidden="true" /> 方向比较
        </Link>
        <span>D1-A 研究稿 · 待审阅</span>
      </div>
      <header className={styles.productHeader}>
        <Link
          href={`/studies/historical/${direction}/cover`}
          className={styles.wordmark}
        >
          千载同心<span>QUIZFORGE</span>
        </Link>
        <span>
          {t.name} / {state === "cover" ? "封面" : "档案"}
        </span>
      </header>
      <div className={styles.prototypeBody}>
        {state === "cover" ? (
          <Cover direction={direction} />
        ) : (
          <Portrait direction={direction} />
        )}
      </div>
      <footer className={styles.prototypeFooter}>
        <span>QUIZFORGE · 视觉探索 {t.number}</span>
        <Link
          href={`/studies/historical/${direction === "folio" ? "cabinet" : "folio"}/${state}`}
        >
          查看另一方向 <ArrowRight size={15} aria-hidden="true" />
        </Link>
        <p>合成展示 · AI 概念素材待审 · 非已发布商品</p>
      </footer>
    </main>
  );
}
