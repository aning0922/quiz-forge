"use client";
import { useEffect, useState } from "react";
import type {
  PreviewAsset,
  PreviewBinding,
} from "@/features/product/preview/contracts";
import { loadPreviewImage, type VerifiedImage } from "./media";
import { previewMessage } from "./client";
import styles from "./preview.module.css";
export function PreviewImage({
  binding,
  asset,
  onFailure,
}: {
  binding: PreviewBinding;
  asset: PreviewAsset;
  onFailure: (error: unknown) => void;
}) {
  const [attempt, setAttempt] = useState(0),
    [state, setState] = useState<{
      attempt: number;
      image?: VerifiedImage;
      error?: string;
    }>({ attempt: 0 });
  useEffect(() => {
    const controller = new AbortController();
    let current = true,
      owned: VerifiedImage | undefined;
    void loadPreviewImage(binding, asset, controller.signal).then(
      (image) => {
        if (!current) {
          image.release();
          return;
        }
        owned = image;
        setState({ attempt, image });
      },
      (error) => {
        if (current) {
          setState({ attempt, error: previewMessage(error) });
          onFailure(error);
        }
      },
    );
    return () => {
      current = false;
      controller.abort();
      owned?.release();
    };
  }, [binding, asset, attempt, onFailure]);
  const active = state.attempt === attempt;
  return (
    <div className={styles.media}>
      {active && state.image ? (
        <>
          {/* Private, verified Blob URL; deliberately bypasses the public Next image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={state.image.url}
            width={asset.width}
            height={asset.height}
            alt={asset.alt}
          />
          <span className={styles.assetBadge} data-preview-approval>
            {asset.approval === "pending" ? "素材待审" : "素材声明已批准"}
          </span>
        </>
      ) : active && state.error ? (
        <div className={styles.mediaStatus} role="alert">
          <p>{state.error}</p>
          <button onClick={() => setAttempt((n) => n + 1)}>重试素材读取</button>
        </div>
      ) : (
        <div className={styles.mediaStatus} role="status">
          正在核验并读取素材…
        </div>
      )}
    </div>
  );
}
