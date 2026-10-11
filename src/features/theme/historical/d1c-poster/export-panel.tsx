"use client";

import { useEffect, useRef, useState } from "react";
import type { HistoricalPosterView } from "@/features/report/historical-poster-view";
import { renderHistoricalPoster } from "@/features/report/poster-export";
import styles from "./export-panel.module.css";

interface Generated {
  readonly url: string;
  readonly file: File;
}
const filename = "quizforge-historical-demo-1080x1920.png";

export function HistoricalPosterExport({
  view,
}: {
  view: HistoricalPosterView;
}) {
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const locked = useRef(false);
  const shareLocked = useRef(false);
  const alive = useRef(true);
  const currentUrl = useRef<string | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    };
  }, []);

  async function generate() {
    if (locked.current || shareLocked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    setStatus("");
    // A failed regeneration must not leave a stale download masquerading as the new work.
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    currentUrl.current = null;
    setGenerated(null);
    try {
      const blob = await renderHistoricalPoster(view);
      if (!alive.current) return;
      const url = URL.createObjectURL(blob);
      currentUrl.current = url;
      setGenerated({
        url,
        file: new File([blob], filename, { type: "image/png" }),
      });
      setStatus("PNG 已生成，可预览、下载或分享；尚未保存到相册。");
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof Error ? failure.message : "海报生成失败，请重试。",
        );
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function share() {
    if (!generated || locked.current || shareLocked.current) return;
    shareLocked.current = true;
    setSharing(true);
    setError(null);
    try {
      if (
        !navigator.canShare?.({ files: [generated.file] }) ||
        !navigator.share
      )
        throw new Error(
          "此浏览器不支持图片文件分享，请下载 PNG 或打开图片保存。",
        );
      // The already generated File preserves this new click's user activation.
      await navigator.share({
        files: [generated.file],
        title: "QuizForge 收藏海报",
      });
      if (alive.current)
        setStatus("分享流程已返回，请在目标应用确认；无法确认相册保存。");
    } catch (failure) {
      if (!alive.current) return;
      if (failure instanceof DOMException && failure.name === "AbortError")
        setStatus("已取消分享，PNG 仍可下载或重新分享。");
      else
        setError(
          failure instanceof Error
            ? failure.message
            : "分享未完成，请尝试下载 PNG。",
        );
    } finally {
      shareLocked.current = false;
      if (alive.current) setSharing(false);
    }
  }

  return (
    <section
      className={styles.panel}
      data-poster-export
      aria-label="PNG 海报导出"
    >
      <h2>收藏这张画</h2>
      <p>生成 1080 × 1920 PNG，保留合成演示标记。画作与内容商用审批待完成。</p>
      <button
        type="button"
        onClick={() => void generate()}
        disabled={busy || sharing}
      >
        {busy
          ? "正在生成…"
          : generated
            ? "重新生成 PNG"
            : error
              ? "重试生成 PNG"
              : "生成 PNG 海报"}
      </button>
      <p role="status">{status}</p>
      {error && <p role="alert">{error}</p>}
      {generated && (
        <>
          {/* A local generated Blob cannot use Next's remote image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={generated.url}
            width={1080}
            height={1920}
            alt="生成的历史人物收藏 PNG 海报预览"
            data-generated-poster
          />
          <a
            href={generated.url}
            download={filename}
            onClick={() =>
              setStatus(
                "已发起 PNG 下载，请在浏览器下载列表确认；尚未确认相册保存。",
              )
            }
          >
            下载 PNG 海报
          </a>
          <button type="button" onClick={() => void share()} disabled={sharing}>
            {sharing ? "分享中…" : "分享 PNG"}
          </button>
          <a href={generated.url} target="_blank" rel="noreferrer">
            打开图片保存
          </a>
          <p>
            iPhone / Safari
            可打开图片后长按，或使用系统分享菜单；安卓可下载或分享。菜单和保存位置因浏览器而异，请自行确认。
          </p>
        </>
      )}
    </section>
  );
}
