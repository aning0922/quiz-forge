"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "./candidate.module.css";

/** A local responsive asset, not a URL supplied by a QuizPack or an answer. */
export function CandidateImage({
  asset,
  alt,
  eager = false,
  className,
  sizes,
}: {
  asset: "figure" | "room-1" | "room-2" | "room-3" | "room-4";
  alt: string;
  eager?: boolean;
  className?: string | undefined;
  sizes?: string;
}) {
  const [state, setState] = useState<"loading" | "ready" | "missing">(
    "loading",
  );
  const figure = asset === "figure";
  const base = `/assets/themes/historical/visual-v2-c/${asset}`;
  return (
    <div
      className={`${styles.image} ${className ?? ""}`}
      data-candidate-image
      data-image-state={state}
    >
      {state !== "missing" && (
        <picture>
          <source
            srcSet={`${figure ? `${base}-160.webp 160w, ` : ""}${base}-480.webp 480w, ${base}-960.webp 960w`}
            sizes={sizes ?? "(min-width: 900px) 480px, 100vw"}
          />
          <Image
            src={`${base}-480.webp`}
            alt={alt}
            width={figure ? 1024 : 1672}
            height={figure ? 1536 : 941}
            unoptimized
            loading={eager ? "eager" : "lazy"}
            fetchPriority={eager ? "high" : "auto"}
            onLoad={() => setState("ready")}
            onError={() => setState("missing")}
          />
        </picture>
      )}
      {state !== "ready" && (
        <span className={styles.imageStatus} role="status">
          {state === "loading" ? "画作正在展开" : "画作暂未呈现"}
          <small>文字与操作仍可使用</small>
        </span>
      )}
    </div>
  );
}
