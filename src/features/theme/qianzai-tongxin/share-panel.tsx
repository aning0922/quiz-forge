"use client";
/* eslint-disable @next/next/no-img-element -- Preview the provider-owned PNG bytes without re-encoding. */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Check,
  FileImage,
  ImageIcon,
  Minus,
  Plus,
  Share2,
  X,
} from "lucide-react";
import { useQianzaiExport } from "./export-context";
import type {
  QianzaiExportContextValue,
  QianzaiExportErrorCode,
  QianzaiExportKind,
} from "@/features/report/qianzai-tongxin/contracts";
import styles from "./share.module.css";

const KINDS = ["poster", "full-report"] as const;
const LABELS = { poster: "相逢海报", "full-report": "完整报告长图" };
const ZOOMS = [1, 1.35, 1.7, 2.05] as const;
function unavailable(code: QianzaiExportErrorCode | null) {
  if (code === "ARTWORK_UNAVAILABLE") return "人物画作或姓名图尚未就绪。";
  if (code === "FONT_UNAVAILABLE" || code === "FONT_COVERAGE")
    return "图片所需字体尚未就绪。";
  if (code === "AUTHORITY_LOST" || code === "NOT_COMPLETED")
    return "当前无法读取本轮报告，请返回后重新验证。";
  if (code === "CONTENT_LIMIT") return "本轮内容暂时超出图片生成范围。";
  if (code === "RESOURCE_UNAVAILABLE") return "图片所需素材暂未能读取。";
  if (code === "PNG_UNAVAILABLE") return "这次未能生成 PNG，可以重新生成。";
  if (code === "CANCELLED") return "这次图片生成已取消。";
  if (code === "BUSY") return "另一张画卷正在生成，请稍候。";
  return "当前版本暂未开放此类图片。";
}

export function QianzaiSharePanel({ active = true }: { active?: boolean }) {
  const api = useQianzaiExport();
  const [intent, setIntent] = useState<QianzaiExportKind | null>(null);
  const available = KINDS.some((kind) => api.availability[kind].allowed);
  const note = useId(),
    close = useRef(api.close);
  useLayoutEffect(() => {
    close.current = api.close;
  }, [api.close]);
  useEffect(() => {
    if (!active) close.current();
    return () => close.current();
  }, [active]);
  const open = (kind: QianzaiExportKind | null) => {
    setIntent(kind);
    api.open();
    if (kind) void api.generate(kind);
  };
  return (
    <>
      <div className={styles.entryActions}>
        <button
          disabled={!available || !active}
          onClick={() => open(null)}
          aria-describedby={!available ? note : undefined}
        >
          保存我的结果 <ArrowRight size={18} aria-hidden="true" />
        </button>
        <button
          disabled={!api.availability.poster.allowed || !active}
          onClick={() => open("poster")}
        >
          预览 / 分享相逢海报
        </button>
      </div>
      {!available && (
        <p id={note} className={styles.entryNote}>
          {unavailable(api.availability.poster.reason)}
        </p>
      )}
      {active && api.state.phase !== "closed" && (
        <ShareDialog api={api} initial={intent} />
      )}
    </>
  );
}

function ShareDialog({
  api,
  initial,
}: {
  api: QianzaiExportContextValue;
  initial: QianzaiExportKind | null;
}) {
  const [view, setView] = useState<"choose" | "preview">(
      initial ? "preview" : "choose",
    ),
    [kind, setKind] = useState<QianzaiExportKind>(
      initial ?? (api.availability.poster.allowed ? "poster" : "full-report"),
    ),
    [zoom, setZoom] = useState<number>(1),
    [notice, setNotice] = useState(""),
    [preparing, setPreparing] = useState(!initial),
    [sharing, setSharing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    port = useRef<HTMLDivElement>(null),
    chooserClose = useRef<HTMLButtonElement>(null),
    previewBack = useRef<HTMLButtonElement>(null),
    noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    live = useRef(true),
    shareLock = useRef(false);
  const prepared = useRef(false),
    latestApi = useRef(api),
    currentView = useRef(view);
  useLayoutEffect(() => {
    latestApi.current = api;
    currentView.current = view;
  }, [api, view]);
  const id = useId();
  const artifact =
    api.state.phase === "ready" && api.state.artifact.kind === kind
      ? api.state.artifact
      : null;
  const busy = api.state.phase === "rendering";
  useEffect(() => {
    if (view !== "choose" || busy || prepared.current) return;
    prepared.current = true;
    void Promise.resolve().then(async () => {
      if (!live.current || currentView.current !== "choose") return;
      setPreparing(true);
      try {
        for (const item of KINDS) {
          const current = latestApi.current;
          if (
            !live.current ||
            currentView.current !== "choose" ||
            current.state.phase === "closed"
          )
            return;
          if (
            current.availability[item].allowed &&
            !current.getCachedArtifact(item)
          )
            await current.generate(item);
        }
      } finally {
        if (live.current) setPreparing(false);
      }
    });
  }, [view, busy]);
  const failure =
    api.state.phase === "error" && api.state.kind === kind
      ? api.state.code
      : null;
  useLayoutEffect(() => {
    const node = dialog.current,
      previous = document.activeElement;
    node?.showModal();
    return () => {
      node?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  useLayoutEffect(() => {
    if (view !== "preview" || !port.current) return;
    const node = port.current;
    const measure = () =>
      node.style.setProperty("--preview-width", `${node.clientWidth}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [view]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);
  useLayoutEffect(() => {
    (view === "choose" ? chooserClose.current : previewBack.current)?.focus({
      preventScroll: true,
    });
  }, [view]);
  const message = (text: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => {
      if (live.current) setNotice("");
    }, 3600);
  };
  const preview = (next: QianzaiExportKind) => {
    setKind(next);
    setView("preview");
    setZoom(1);
    setNotice("");
    if (port.current) {
      port.current.scrollTop = 0;
      port.current.scrollLeft = 0;
    }
    void api.generate(next);
  };
  const fit = () => {
    setZoom(1);
    if (port.current) port.current.scrollLeft = 0;
  };
  const share = async () => {
    if (shareLock.current) return;
    shareLock.current = true;
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice("");
    setSharing(true);
    const outcome = await api.share();
    if (!live.current) return;
    shareLock.current = false;
    setSharing(false);
    if (outcome === "cancelled") return;
    message(
      outcome === "shared"
        ? "已交给系统分享。"
        : outcome === "failed"
          ? "系统分享未完成，请先保存 PNG 后发送。"
          : "当前浏览器无法直接分享 PNG，请先保存图片后发送。",
    );
  };
  const choose = () => {
    setPreparing(!prepared.current);
    setView("choose");
    setNotice("");
  };
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={`${id}-title`}
      data-qianzai-share
      data-view={view}
      onClick={(event) => {
        if (event.target === event.currentTarget) api.close();
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (view === "preview") choose();
        else api.close();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {view === "choose" ? (
        <section className={styles.sheet}>
          <header className={styles.sheetHead}>
            <div>
              <p className={styles.kicker}>终章 · 留住这一程</p>
              <h2 id={`${id}-title`}>选择要保存的画卷</h2>
              <p>
                相逢海报适合分享，完整长图适合收藏。两种图片均可预览后保存。
              </p>
            </div>
            <button
              ref={chooserClose}
              className={styles.round}
              onClick={api.close}
              aria-label="关闭保存选项"
            >
              <X size={22} />
            </button>
          </header>
          <div className={styles.cards} role="group" aria-label="保存类型">
            {KINDS.map((item) => {
              const ready = api.getCachedArtifact(item);
              const allowed = api.availability[item].allowed;
              return (
                <button
                  key={item}
                  className={styles.card}
                  aria-pressed={item === kind}
                  disabled={!allowed || busy || preparing}
                  onClick={() => setKind(item)}
                >
                  <span className={styles.thumb} data-kind={item}>
                    {ready ? (
                      <img
                        src={ready.previewUrl}
                        alt={`${LABELS[item]}已生成图片缩略图`}
                      />
                    ) : (
                      <span className={styles.emptyThumb}>
                        {item === "poster" ? (
                          <ImageIcon size={32} aria-hidden="true" />
                        ) : (
                          <FileImage size={32} aria-hidden="true" />
                        )}
                        <span>
                          {allowed
                            ? preparing
                              ? "正在生成预览…"
                              : "预览暂未生成"
                            : "暂不可用"}
                        </span>
                      </span>
                    )}
                    <span className={styles.pill}>
                      {item === "poster" ? "分享" : "收藏"}
                    </span>
                  </span>
                  <strong>{LABELS[item]}</strong>
                  <small>
                    {allowed
                      ? item === "poster"
                        ? "人物 · 契合指数 · 五维图"
                        : "六卷全文 · 实际选择依据"
                      : unavailable(api.availability[item].reason)}
                  </small>
                  {ready && (
                    <small>
                      {ready.width} × {ready.height}
                    </small>
                  )}
                  <span className={styles.radio} aria-hidden="true">
                    {item === kind && <Check size={13} />}
                  </span>
                </button>
              );
            })}
          </div>
          <footer className={styles.sheetFoot}>
            <p>图片取自本轮报告，可预览后保存。</p>
            <button
              className={styles.primary}
              disabled={
                !api.availability[kind].allowed ||
                preparing ||
                (api.state.phase === "rendering" && api.state.kind !== kind)
              }
              onClick={() => preview(kind)}
            >
              {preparing
                ? "正在准备图片…"
                : busy
                  ? "查看生成进度"
                  : "查看图片预览"}{" "}
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </footer>
        </section>
      ) : (
        <section className={styles.preview}>
          <header className={styles.previewHead}>
            <button
              ref={previewBack}
              className={styles.back}
              onClick={choose}
              aria-label="返回选择保存类型"
            >
              <ArrowLeft size={22} />
            </button>
            <div>
              <h2 id={`${id}-title`}>{LABELS[kind]}</h2>
              <p>
                {artifact
                  ? `${artifact.width} × ${artifact.height} · PNG`
                  : busy
                    ? "正在生成本轮图片…"
                    : "本轮报告图片预览"}
              </p>
            </div>
            <button
              className={styles.counter}
              aria-label={`切换为${LABELS[kind === "poster" ? "full-report" : "poster"]}`}
              disabled={
                busy ||
                !api.availability[kind === "poster" ? "full-report" : "poster"]
                  .allowed
              }
              onClick={() =>
                preview(kind === "poster" ? "full-report" : "poster")
              }
            >
              {kind === "poster" ? "01 / 02" : "02 / 02"}
            </button>
            <button
              className={styles.closePreview}
              onClick={api.close}
              aria-label="关闭图片预览"
            >
              <X size={20} />
            </button>
          </header>
          <div className={styles.zoomRow}>
            <span>双击放大 · 滑动查看</span>
            <div>
              <button
                aria-label="缩小图片"
                disabled={!artifact || zoom === ZOOMS[0]}
                onClick={() =>
                  setZoom(
                    ZOOMS[
                      Math.max(
                        0,
                        ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]) - 1,
                      )
                    ]!,
                  )
                }
              >
                <Minus size={18} />
              </button>
              <output aria-label="图片缩放比例">
                {Math.round(zoom * 100)}%
              </output>
              <button
                aria-label="放大图片"
                disabled={!artifact || zoom === ZOOMS[ZOOMS.length - 1]}
                onClick={() =>
                  setZoom(
                    ZOOMS[
                      Math.min(
                        ZOOMS.length - 1,
                        ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]) + 1,
                      )
                    ]!,
                  )
                }
              >
                <Plus size={18} />
              </button>
              <button className={styles.fit} disabled={!artifact} onClick={fit}>
                适配
              </button>
            </div>
          </div>
          <div
            ref={port}
            className={styles.imageScroll}
            data-qianzai-scroll-region
            tabIndex={0}
            aria-label="图片预览，可横向和纵向滚动"
          >
            {artifact ? (
              <div className={styles.imageStage}>
                <img
                  src={artifact.previewUrl}
                  alt={`${LABELS[kind]}原样预览`}
                  draggable={false}
                  style={{
                    width: `calc((var(--preview-width) - 32px) * ${zoom})`,
                  }}
                  onDoubleClick={() => setZoom(zoom === 1 ? 1.7 : 1)}
                />
                <p>预览、保存与分享使用同一张 PNG。</p>
              </div>
            ) : (
              <div className={styles.pending} role="status">
                {busy ? (
                  <>
                    <span className={styles.spinner} aria-hidden="true" />
                    <h3>正在展开本轮画卷</h3>
                    <p>生成后即可预览和保存。</p>
                  </>
                ) : (
                  <>
                    <FileImage size={36} aria-hidden="true" />
                    <h3>画卷暂未生成</h3>
                    <p>
                      {failure
                        ? unavailable(failure)
                        : unavailable(api.availability[kind].reason)}
                    </p>
                    <button
                      disabled={!api.availability[kind].allowed}
                      onClick={() => preview(kind)}
                    >
                      重新生成
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
          <footer className={styles.actions}>
            <div>
              <button
                disabled={!artifact || sharing || busy}
                onClick={() => void share()}
              >
                <Share2 size={18} aria-hidden="true" />
                {sharing ? "正在打开分享…" : "分享图片"}
              </button>
              <button
                disabled={!artifact || busy}
                onClick={() =>
                  message(
                    api.download()
                      ? "已发起 PNG 下载，请查看浏览器下载内容。"
                      : "未能发起下载，可尝试长按预览图保存。",
                  )
                }
              >
                保存 PNG <ArrowDown size={18} aria-hidden="true" />
              </button>
            </div>
            <p>下载位置由浏览器决定，手机上也可长按预览图保存。</p>
          </footer>
        </section>
      )}
      {notice && (
        <p className={styles.toast} role="status">
          {notice}
        </p>
      )}
    </dialog>
  );
}
