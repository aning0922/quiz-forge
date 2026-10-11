"use client";

import Image from "next/image";
import { useState } from "react";
import { historicalAssets } from "./tokens";
import styles from "./historical.module.css";

/** Failure reserves the composition without substituting an unapproved portrait. */
export function Character({
  asset = {
    src: historicalAssets.character,
    alt: "李白艺术化概念立绘：米白长袍、青绿内衫，手持竹卷",
  },
  className = "",
}: {
  asset?: { src: string; alt: string } | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`${styles.character} ${className}`}>
      {failed || asset === null ? (
        <p className={styles.assetFallback} role="status">
          {asset === null ? "该人物立绘待补齐" : "人物概念图暂不可用"}
          <br />
          请参阅素材审核清单
        </p>
      ) : (
        <Image
          src={asset.src}
          alt={asset.alt}
          width={800}
          height={1200}
          unoptimized
          loading="eager"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
