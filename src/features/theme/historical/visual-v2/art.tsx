"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "./visual-v2.module.css";

export function StudyArt({
  src,
  alt,
  className = "",
  portrait = false,
}: {
  src: string;
  alt: string;
  className?: string;
  portrait?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={`${styles.art} ${className}`}
      data-asset-state={failed ? "missing" : "ready"}
    >
      {failed ? (
        <p className={styles.missing} role="status">
          {portrait ? "人物画作暂未呈现" : "山水画作暂未呈现"}
          <span>{portrait ? "仍可阅读下方人物志" : "你的旅程仍可继续"}</span>
        </p>
      ) : (
        <Image
          unoptimized
          src={src}
          alt={alt}
          width={portrait ? 800 : 1024}
          height={portrait ? 1200 : 1536}
          loading="eager"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
