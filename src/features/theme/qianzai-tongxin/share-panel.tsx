"use client";
/* eslint-disable @next/next/no-img-element -- Preview the provider-owned PNG bytes without re-encoding. */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FileImage, ImageIcon, X } from "lucide-react";
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

export function QianzaiSharePanel({
  active = true,
  referenceOnly = false,
  prepareEnabled = true,
}: {
  active?: boolean;
  referenceOnly?: boolean;
  prepareEnabled?: boolean;
}) {
  const api = useQianzaiExport();
  const { prepare: prepareReport, close: releaseReport } = api;
  const [intent, setIntent] = useState<QianzaiExportKind | null>(null);
  const cycle = useMemo(() => ({ active, open: api.open }), [active, api.open]);
  const [openedCycle, setOpenedCycle] = useState<object | null>(null);
  const shown = openedCycle === cycle;
  const available = KINDS.some((kind) => api.availability[kind].allowed);
  const note = useId();
  useEffect(() => {
    if (!active) releaseReport();
    return () => releaseReport();
  }, [active, releaseReport]);
  useEffect(() => {
    if (!active || !prepareEnabled) return;
    let live = true;
    let idle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const prepare = () => {
      if (document.visibilityState === "hidden") return;
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) clearTimeout(timer);
      const memory = (navigator as Navigator & { deviceMemory?: number })
        .deviceMemory;
      const work = () => {
        if (live) void prepareReport(memory === undefined || memory > 2);
      };
      if ("requestIdleCallback" in window)
        idle = window.requestIdleCallback(work);
      else timer = setTimeout(work, 0);
    };
    prepare();
    document.addEventListener("visibilitychange", prepare);
    return () => {
      live = false;
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", prepare);
    };
  }, [active, prepareEnabled, prepareReport]);
  const open = (kind: QianzaiExportKind | null) => {
    setIntent(kind);
    api.open();
    setOpenedCycle(cycle);
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
          保存我的结果 <span aria-hidden="true">↗</span>
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
      {active && shown && api.state.phase !== "closed" && (
        <ShareDialog
          api={api}
          initial={intent}
          referenceOnly={referenceOnly}
          onDismiss={() => setOpenedCycle(null)}
        />
      )}
    </>
  );
}

function ShareDialog({
  api,
  initial,
  referenceOnly,
  onDismiss,
}: {
  api: QianzaiExportContextValue;
  initial: QianzaiExportKind | null;
  referenceOnly: boolean;
  onDismiss(): void;
}) {
  const [view, setView] = useState<"choose" | "preview">(
      initial ? "preview" : "choose",
    ),
    [kind, setKind] = useState<QianzaiExportKind>(
      initial ?? (api.availability.poster.allowed ? "poster" : "full-report"),
    ),
    [zoom, setZoom] = useState<number>(1),
    [notice, setNotice] = useState(""),
    [sharing, setSharing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    port = useRef<HTMLDivElement>(null),
    chooserClose = useRef<HTMLButtonElement>(null),
    previewBack = useRef<HTMLButtonElement>(null),
    noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    live = useRef(true),
    shareLock = useRef(false);
  const id = useId();
  const artifact = api.getCachedArtifact(kind);
  const busy = !artifact && !api.getFailure(kind);
  const failure = api.getFailure(kind);
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
        if (event.target === event.currentTarget) onDismiss();
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (view === "preview") choose();
        else onDismiss();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {view === "choose" ? (
        <section className={styles.sheet}>
          <header className={styles.sheetHead}>
            <div>
              <div className={styles.kicker}>终章 · 留住这一程</div>
              <h2 id={`${id}-title`}>选择要保存的画卷</h2>
              <p>
                相逢海报适合分享，完整长图适合收藏。两种图片均可预览后保存。
              </p>
            </div>
            <button
              ref={chooserClose}
              className={styles.round}
              onClick={onDismiss}
              aria-label="关闭保存选项"
            >
              ×
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
                  disabled={!allowed}
                  onClick={() => {
                    setKind(item);
                    void api.generate(item);
                  }}
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
                            ? api.getFailure(item)
                              ? "预览未完成，可点击重试"
                              : api.state.phase === "rendering"
                                ? `正在准备${LABELS[item]}…`
                                : "点击准备图片预览"
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
                        : "五维详解 · 答题依据"
                      : unavailable(api.availability[item].reason)}
                    {ready && (
                      <>
                        <br />
                        {`${item === "full-report" ? "一张图 · " : ""}${ready.width} × ${ready.height}`}
                      </>
                    )}
                  </small>
                  <span className={styles.radio} aria-hidden="true">
                    {item === kind && "✓"}
                  </span>
                </button>
              );
            })}
          </div>
          <footer className={styles.sheetFoot}>
            <div className={styles.hint}>
              {referenceOnly ? (
                <>
                  <span>研究样稿：</span>89%
                  和五维为演示数值，二维码仅为不可扫描占位。
                </>
              ) : (
                "长图包含六卷正文与引用依据；全部24题记录可在报告内查看。"
              )}
            </div>
            <button
              className={styles.primary}
              aria-label="查看图片预览"
              disabled={!api.availability[kind].allowed}
              onClick={() => preview(kind)}
            >
              {busy ? "查看准备进度" : "查看图片预览"}
              {"　→"}
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
              ‹
            </button>
            <div className={styles.previewTitle}>
              <strong id={`${id}-title`}>{LABELS[kind]}</strong>
              <small>
                {artifact
                  ? `${artifact.width} × ${artifact.height} · ${referenceOnly ? "原图无重绘" : "PNG"}`
                  : busy
                    ? "正在生成本轮图片…"
                    : "本轮报告图片预览"}
              </small>
            </div>
            <button
              className={styles.counter}
              aria-label={`切换为${LABELS[kind === "poster" ? "full-report" : "poster"]}`}
              disabled={
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
              onClick={onDismiss}
              aria-label="关闭图片预览"
            >
              <X size={20} />
            </button>
          </header>
          <div className={styles.zoomRow}>
            <span className={styles.previewNote}>
              {kind === "poster"
                ? "可长按保存，双击放大"
                : "单张长卷 · 上下滑动，双击放大"}
            </span>
            <div className={styles.zoomControls}>
              <button
                aria-label="缩小图片"
                disabled={!artifact}
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
                −
              </button>
              <output className={styles.zoomValue} aria-label="图片缩放比例">
                {Math.round(zoom * 100)}%
              </output>
              <button
                aria-label="放大图片"
                disabled={!artifact}
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
                ＋
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
                <div className={styles.imageCaption}>
                  {referenceOnly
                    ? "视觉研究样稿：图中契合指数、五维与答题解读为演示内容，二维码为占位。"
                    : "预览、保存与分享使用同一张 PNG。"}
                </div>
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
            <div className={styles.buttonRow}>
              <button
                className={styles.secondary}
                disabled={!artifact || sharing || busy}
                onClick={() => void share()}
              >
                {sharing ? "正在打开分享…" : "分享图片"}
              </button>
              <button
                className={styles.gold}
                disabled={!artifact || busy}
                onClick={() =>
                  message(
                    api.download()
                      ? "已发起 PNG 下载，请查看浏览器下载内容。"
                      : "未能发起下载，可尝试长按预览图保存。",
                  )
                }
              >
                {"保存 PNG　↓"}
              </button>
            </div>
            <small>下载位置由浏览器决定，手机上也可长按预览图保存。</small>
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
