"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "./art-study.module.css";

export function ArtImage({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  return (
    <div className={styles.artwork} data-artwork data-artwork-state={state}>
      {state !== "unavailable" && (
        <Image
          data-art-image
          src={src}
          alt={alt}
          width={1024}
          height={1536}
          unoptimized
          loading="eager"
          fetchPriority="high"
          onLoad={() => setState("ready")}
          onError={() => setState("unavailable")}
        />
      )}
      {state !== "ready" && (
        <p className={styles.artStatus} role="status">
          {state === "loading" ? "画作正在展开" : "画作暂未呈现"}
          <span>
            {state === "loading"
              ? "人物题名与性情文字可先阅读"
              : "图像加载失败，仍可继续阅读报告"}
          </span>
        </p>
      )}
    </div>
  );
}
