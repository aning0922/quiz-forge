"use client";

import { useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronUp, MoreHorizontal } from "lucide-react";
import {
  QianzaiPetals,
  QianzaiWater,
  useQianzaiMotion,
} from "@/features/theme/qianzai-tongxin/motion";
import {
  PlatformArtwork,
  PlatformModal,
  PlatformRedemption,
  type PlatformHomeAssets,
} from "./platform-home";
import qianzaiStyles from "@/features/theme/qianzai-tongxin/qianzai.module.css";
import styles from "./platform-home.module.css";

/** Public artwork only. No consumer model or authority is created on this page. */
export function QianzaiPublicEntry({
  assets,
  homeHref = "/",
  redemptionForm,
}: {
  assets: PlatformHomeAssets;
  homeHref?: string;
  redemptionForm: ReactNode;
}) {
  const [redeem, setRedeem] = useState(false),
    [options, setOptions] = useState(false),
    [paused, setPaused] = useState(false),
    [ready, setReady] = useState(false);
  const touch = useRef<{ id: number; x: number; y: number } | null>(null),
    dialogOpen = useRef(false);
  const openRedemption = () => {
    touch.current = null;
    if (dialogOpen.current) return;
    dialogOpen.current = true;
    setRedeem(true);
  };
  const closeRedemption = () => {
    touch.current = null;
    dialogOpen.current = false;
    setRedeem(false);
  };
  const motion = useQianzaiMotion(!paused && !redeem);
  return (
    <main
      id="main"
      tabIndex={-1}
      className={`${styles.stage} ${styles.entryStage}`}
    >
      <div className={`${styles.frame} ${styles.entryFrame}`}>
        <section
          className={`${styles.coverScene} ${qianzaiStyles.coverScene}`}
          data-motion={motion ? "running" : "paused"}
          onTouchStart={(event) => {
            const target =
                event.target instanceof Element ? event.target : null,
              point = event.touches[0];
            touch.current =
              !options &&
              !dialogOpen.current &&
              event.touches.length === 1 &&
              point &&
              !target?.closest(
                'button, a, input, textarea, select, [role="button"], dialog',
              )
                ? { id: point.identifier, x: point.clientX, y: point.clientY }
                : null;
          }}
          onTouchMove={(event) => {
            if (
              event.touches.length !== 1 ||
              event.touches[0]?.identifier !== touch.current?.id
            )
              touch.current = null;
          }}
          onTouchCancel={() => {
            touch.current = null;
          }}
          onTouchEnd={(event) => {
            const start = touch.current,
              point = event.changedTouches[0];
            touch.current = null;
            if (
              !start ||
              !point ||
              event.touches.length !== 0 ||
              event.changedTouches.length !== 1 ||
              point.identifier !== start.id ||
              options ||
              dialogOpen.current
            )
              return;
            const upward = start.y - point.clientY;
            if (
              upward >= 56 &&
              upward >= Math.abs(start.x - point.clientX) * 1.25
            )
              openRedemption();
          }}
        >
          <PlatformArtwork
            src={assets.cover}
            alt="千载同心，岸边灯影封面"
            className={`${styles.coverArt} ${qianzaiStyles.fullArt}`}
            onReady={() => setReady(true)}
          />
          {ready && (
            <>
              <div
                className={qianzaiStyles.coverIntroShade}
                aria-hidden="true"
              />
              <div className={qianzaiStyles.lamps} aria-hidden="true">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <i key={i} />
                ))}
              </div>
              <QianzaiWater src={assets.cover} active={motion} />
              <QianzaiPetals active={motion} />
            </>
          )}
          <h1 className={ready ? styles.srOnly : styles.missingCoverTitle}>
            千载同心
          </h1>
          <p className={styles.coverFact}>一场穿越千年的相遇</p>
          <button
            className={`${styles.coverStart} ${qianzaiStyles.scrollButton}`}
            onClick={openRedemption}
            aria-label="开启穿越之旅，兑换资格"
            data-art-ready={ready}
          >
            <span className={ready ? styles.srOnly : undefined}>
              开启穿越之旅
            </span>
          </button>
          <div className={qianzaiStyles.waterway} aria-hidden="true" />
          <button className={styles.coverSwipe} onClick={openRedemption}>
            <ChevronUp
              size={23}
              aria-hidden="true"
              className={ready ? styles.srOnly : undefined}
            />
            <span className={ready ? styles.srOnly : undefined}>
              上滑也可启程
            </span>
          </button>
          <a href={homeHref} className={styles.storyBack}>
            <ArrowLeft size={15} aria-hidden="true" />
            返回平台
          </a>
          <button
            className={styles.motionToggle}
            onClick={() => setOptions(!options)}
            aria-label="封面动效设置"
            aria-expanded={options}
          >
            <MoreHorizontal size={24} />
          </button>
          {options && (
            <div className={styles.motionOptions}>
              <button onClick={() => setPaused(!paused)} aria-pressed={paused}>
                {paused ? "继续动效" : "暂停动效"}
              </button>
            </div>
          )}
        </section>
        {redeem && (
          <PlatformModal title="兑换这段旅程" dark onClose={closeRedemption}>
            <p>输入有效兑换码，经验证后进入对应作品或已有报告。</p>
            <PlatformRedemption>{redemptionForm}</PlatformRedemption>
            <button className={styles.lightButton} onClick={closeRedemption}>
              先看看封面
            </button>
          </PlatformModal>
        )}
      </div>
    </main>
  );
}
