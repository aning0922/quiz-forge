import { ArrowDown, BookOpen, Layers, Route } from "lucide-react";
import {
  CardBack,
  PrimaryLink,
  StudyShell,
  studyPath,
  type Direction,
} from "./shared";
import { StudyArt } from "./art";
import styles from "./visual-v2.module.css";

export const journeyArt =
  "/assets/themes/historical/visual-v2/river-journey.webp";

export function VisualCover({ direction }: { direction: Direction }) {
  const journey = direction === "journey";
  return (
    <StudyShell direction={direction} view="cover">
      <section className={styles.cover}>
        <div className={styles.coverCopy}>
          <p className={styles.eyebrow}>
            {journey
              ? "一程山水 · 一次相逢"
              : "东方人物藏馆 / THE CHARACTER ARCHIVE"}
          </p>
          <h1>
            你的性格，
            <br />
            历史上<span>最像谁？</span>
          </h1>
          <p className={styles.coverLead}>
            {journey ? (
              <>
                若置身千年前，
                <br />
                你的选择，会写成谁的故事？
              </>
            ) : (
              <>
                千年风骨万千，
                <br />
                哪一种，恰好与你共鸣？
              </>
            )}
          </p>
        </div>
        <div className={styles.coverArtwork}>
          {journey ? (
            <>
              <StudyArt
                src={journeyArt}
                alt="青绿群山与曲折的河流，一座朱色小桥通向山间"
              />
              <div className={styles.sceneCaption}>
                <span>
                  入画
                  <br />
                  寻己
                </span>
                <small>循山河，见性情</small>
              </div>
              <span className={styles.sceneIndex}>山水第一卷 · 启程</span>
            </>
          ) : (
            <div className={styles.cardStack}>
              <div className={styles.cardStage}>
                <div className={styles.cardStackBack} aria-hidden="true" />
                <CardBack />
              </div>
              <span className={styles.stackCaption}>人物未揭晓 · 等你翻开</span>
            </div>
          )}
        </div>
        <div className={styles.coverAction}>
          <div className={styles.valueLine}>
            <span>
              <Route size={17} aria-hidden="true" />
              12 道情境
            </span>
            <span>
              {journey ? (
                <BookOpen size={17} aria-hidden="true" />
              ) : (
                <Layers size={17} aria-hidden="true" />
              )}
              {journey ? "一份人物志" : "一张风骨藏卡"}
            </span>
          </div>
          <PrimaryLink href={studyPath(direction, "question")}>
            {journey ? "开启寻己之旅" : "翻开你的风骨藏卡"}
          </PrimaryLink>
          <p className={styles.coverNote}>
            约 3 分钟 · 无需注册 · 进度留在本机
          </p>
        </div>
      </section>
      <section className={styles.coverAfter}>
        <p className={styles.eyebrow}>
          你会带走什么 <ArrowDown size={15} aria-hidden="true" />
        </p>
        <h2>
          {journey ? "千载之外，也有同频的人。" : "一份可以慢慢读的自己。"}
        </h2>
        <div className={styles.takeaways}>
          <p>
            <b>01</b>
            <strong>遇见一种风骨</strong>
            <span>从熟悉的生活情境，走向一个人物意象。</span>
          </p>
          <p>
            <b>02</b>
            <strong>读懂性情的侧面</strong>
            <span>看见优势，也给另一面的自己留一点余地。</span>
          </p>
          <p>
            <b>03</b>
            <strong>留下一张人物卡</strong>
            <span>一句心意，一幅画，收藏这次相逢。</span>
          </p>
        </div>
        <details className={styles.about}>
          <summary>关于这次体验</summary>
          <p>
            这是独立视觉研究原型。12
            道题目为合成内容，末尾可查看固定合成揭晓，不会根据答案计算人物。人物插画与山水为待审概念素材，海报仅作视觉预览。
          </p>
        </details>
      </section>
    </StudyShell>
  );
}
