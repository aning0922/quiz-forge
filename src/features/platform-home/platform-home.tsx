"use client";
/* eslint-disable @next/next/no-img-element -- Fixed private artwork is served by the controlled asset route. */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Menu,
  Search,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import styles from "./platform-home.module.css";

/** URLs are supplied by the application composition layer, never by user input. */
export type PlatformHomeAssets = Partial<
  Record<"home" | "qian" | "heart" | "cat" | "cover", string>
>;
export type PlatformHomeProps = {
  assets: PlatformHomeAssets;
  qianzaiHref: string;
  redemptionForm: ReactNode;
  initialView?: PlatformHomeView;
  hrefs?: Partial<Record<PlatformHomeView, string>>;
};
export type PlatformHomeView =
  "home" | "mine" | "catalog" | "search" | "heart" | "cat";
type View = PlatformHomeView;
const PATHS: Record<View, string> = {
  home: "/",
  mine: "/my",
  catalog: "/works",
  search: "/search",
  heart: "/works/heart",
  cat: "/works/cat",
};
const WORKS = [
  {
    id: "qian",
    name: "千载同心",
    description: "若与千载风流人物相遇，谁会与你心意相通？",
    tag: "古风 · 人物相逢",
    category: "古风",
  },
  {
    id: "heart",
    name: "心动气象局",
    description: "如果你的心动是一场天气预报？",
    tag: "都市 · 情感",
    category: "都市",
  },
  {
    id: "cat",
    name: "喵语心事",
    description: "解锁你与猫咪的灵魂羁绊。",
    tag: "动物 · 趣味",
    category: "动物",
  },
] as const;
type Work = (typeof WORKS)[number];

export function PlatformArtwork({
  src,
  alt,
  className,
  onReady,
}: {
  src: string | undefined;
  alt: string;
  className?: string | undefined;
  onReady?: () => void;
}) {
  const [failed, setFailed] = useState<string | undefined>();
  return src && failed !== src ? (
    <img
      src={src}
      alt={alt}
      className={className}
      onLoad={onReady}
      onError={() => setFailed(src)}
      draggable={false}
    />
  ) : (
    <div
      className={`${styles.artMissing} ${className ?? ""}`}
      role="img"
      aria-label={`${alt}，插画暂未载入`}
    >
      <Sparkles aria-hidden="true" size={28} />
      <span>插画暂未载入</span>
    </div>
  );
}

export function PlatformModal({
  title,
  children,
  onClose,
  dark = false,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  dark?: boolean;
}) {
  const node = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useEffect(() => {
    const dialog = node.current,
      previous = document.activeElement;
    const frame = dialog?.parentElement;
    const measure = () => {
      if (!dialog || !frame) return;
      const rect = frame.getBoundingClientRect();
      dialog.style.left = `${rect.left}px`;
      dialog.style.width = `${rect.width}px`;
      dialog.style.bottom = `${Math.max(0, innerHeight - rect.bottom)}px`;
      dialog.style.maxHeight = `${rect.height * 0.9}px`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (frame) observer.observe(frame);
    window.addEventListener("resize", measure);
    dialog?.showModal();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      dialog?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={node}
      className={`${styles.modal} ${dark ? styles.darkModal : ""}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const targets = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]',
          ),
        ).filter((target) => target.getClientRects().length > 0);
        const first = targets[0],
          last = targets.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <section className={styles.sheet}>
        <div className={styles.drag} aria-hidden="true" />
        <button
          className={styles.close}
          onClick={onClose}
          aria-label="关闭弹层"
          autoFocus
        >
          <X size={21} />
        </button>
        <h2 id={titleId}>{title}</h2>
        {children}
      </section>
    </dialog>
  );
}

export function PlatformRedemption({ children }: { children: ReactNode }) {
  return <div className={styles.redemption}>{children}</div>;
}

export function PlatformHome({
  assets,
  qianzaiHref,
  redemptionForm,
  initialView = "home",
  hrefs = {},
}: PlatformHomeProps) {
  const view = initialView;
  const [menu, setMenu] = useState(false),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("全部"),
    [homeFailed, setHomeFailed] = useState<string | undefined>();
  const scroll = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    previousView = useRef(view);
  const href = (next: View) => hrefs[next] ?? PATHS[next];
  useEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    scroll.current?.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [view]);
  const card = (work: Work) => (
    <article className={styles.catalogCard} key={work.id}>
      <PlatformArtwork
        src={assets[work.id]}
        alt={`${work.name}概念插画`}
        className={styles.cardArt}
      />
      <div className={styles.cardInfo}>
        <span className={styles.overline}>
          {work.id === "qian" ? "独立作品 · 封面预览" : "企划预告 · 尚未开放"}
        </span>
        <h3>{work.name}</h3>
        <p>{work.description}</p>
        {work.id === "qian" ? (
          <a className={styles.smallButton} href={qianzaiHref}>
            进入作品 <ArrowRight size={17} aria-hidden="true" />
          </a>
        ) : (
          <a
            className={styles.smallButton}
            href={href(work.id as "heart" | "cat")}
          >
            查看预告 <ArrowRight size={17} aria-hidden="true" />
          </a>
        )}
      </div>
    </article>
  );
  const isHomeArt =
    view === "home" && assets.home && homeFailed !== assets.home;
  return (
    <main id="main" tabIndex={-1} className={styles.stage}>
      <div className={styles.frame}>
        <div ref={scroll} className={styles.content} data-platform-scroll>
          {view === "home" ? (
            <>
              <h1 ref={heading} tabIndex={-1} className={styles.srOnly}>
                QuizForge 评测主页：在每一个世界里，遇见另一个自己。
              </h1>
              {isHomeArt ? (
                <div className={styles.homeShot}>
                  <img
                    src={assets.home}
                    alt=""
                    aria-hidden="true"
                    width={766}
                    height={1377}
                    onError={() => setHomeFailed(assets.home)}
                    draggable={false}
                  />
                  <a
                    className={`${styles.hotspot} ${styles.searchHotspot}`}
                    href={href("search")}
                    aria-label="搜索作品"
                  >
                    <span className={styles.srOnly}>搜索作品</span>
                  </a>
                  <button
                    className={`${styles.hotspot} ${styles.menuHotspot}`}
                    onClick={() => setMenu(true)}
                    aria-label="打开菜单"
                  >
                    <span className={styles.srOnly}>打开菜单</span>
                  </button>
                  <a
                    className={`${styles.hotspot} ${styles.featureHotspot}`}
                    href={qianzaiHref}
                    aria-label="进入千载同心作品封面"
                  >
                    <span className={styles.srOnly}>
                      千载同心：{WORKS[0].description} 进入作品封面
                    </span>
                  </a>
                  <span className={styles.featureBadge} aria-hidden="true">
                    精选作品
                  </span>
                  <a
                    className={`${styles.hotspot} ${styles.exploreHotspot}`}
                    href={href("catalog")}
                    aria-label="探索全部作品"
                  >
                    <span className={styles.srOnly}>探索全部作品</span>
                  </a>
                  <a
                    className={`${styles.hotspot} ${styles.heartHotspot}`}
                    href={href("heart")}
                    aria-label="查看心动气象局预告，筹备中"
                  >
                    <span className={styles.srOnly}>
                      心动气象局：{WORKS[1].description} 筹备中，尚未开放
                    </span>
                  </a>
                  <a
                    className={`${styles.hotspot} ${styles.catHotspot}`}
                    href={href("cat")}
                    aria-label="查看喵语心事预告，筹备中"
                  >
                    <span className={styles.srOnly}>
                      喵语心事：{WORKS[2].description} 筹备中，尚未开放
                    </span>
                  </a>
                  <span
                    className={`${styles.comingBadge} ${styles.heartBadge}`}
                  >
                    筹备中
                  </span>
                  <span className={`${styles.comingBadge} ${styles.catBadge}`}>
                    筹备中
                  </span>
                </div>
              ) : (
                <section className={styles.fallbackHome}>
                  <header>
                    <strong>
                      QuizForge <span>✦</span>
                    </strong>
                    <div>
                      <a href={href("search")} aria-label="搜索作品">
                        <Search size={22} />
                      </a>
                      <button
                        onClick={() => setMenu(true)}
                        aria-label="打开菜单"
                      >
                        <Menu size={23} />
                      </button>
                    </div>
                  </header>
                  <p className={styles.overline}>遇见不同的故事</p>
                  <h2>
                    在每一个世界里，
                    <br />
                    遇见<em>另一个自己。</em>
                  </h2>
                  <p className={styles.lead}>
                    主页插画暂未载入，仍可浏览作品封面与预告。
                  </p>
                  {WORKS.map(card)}
                </section>
              )}
            </>
          ) : (
            <>
              <header className={styles.pageHead}>
                <a
                  className={styles.back}
                  href={href("home")}
                  aria-label="返回评测主页"
                >
                  <ArrowLeft size={22} />
                </a>
                <div>
                  <p className={styles.overline}>
                    {view === "mine"
                      ? "MY QUIZFORGE"
                      : view === "catalog"
                        ? "EXPLORE STORIES"
                        : view === "search"
                          ? "SEARCH"
                          : "COMING SOON"}
                  </p>
                  <h1 ref={heading} tabIndex={-1}>
                    {view === "mine"
                      ? "我的"
                      : view === "catalog"
                        ? "更多精彩故事"
                        : view === "search"
                          ? "寻找一段故事"
                          : "故事预告"}
                  </h1>
                </div>
              </header>
              <section className={styles.section}>
                {view === "mine" ? (
                  <>
                    <p className={styles.overline}>YOUR STORY STARTS HERE</p>
                    <h2 className={styles.intro}>
                      一张入场券，
                      <br />
                      <em>开启一段故事。</em>
                    </h2>
                    <p className={styles.lead}>
                      如果你已获得测评兑换码，可以在这里兑换并进入对应的作品。
                    </p>
                    <div className={styles.redeemPanel}>
                      <Sparkles size={27} aria-hidden="true" />
                      <h2>兑换测评</h2>
                      <p>
                        输入你获得的兑换码。验证通过后，将进入对应作品或已有报告。
                      </p>
                      <PlatformRedemption>{redemptionForm}</PlatformRedemption>
                    </div>
                  </>
                ) : view === "catalog" ? (
                  <>
                    <p className={styles.overline}>CURATED WORLDS</p>
                    <h2 className={styles.intro}>
                      下一段相逢，
                      <br />
                      <em>从这里开始。</em>
                    </h2>
                    <p className={styles.lead}>
                      每款测评拥有独立美术和体验。筹备中的作品仅展示预告，不开放答题。
                    </p>
                    <div
                      className={styles.chips}
                      role="group"
                      aria-label="按题材筛选作品"
                    >
                      {["全部", "古风", "都市", "动物"].map((item) => (
                        <button
                          key={item}
                          aria-pressed={filter === item}
                          onClick={() => setFilter(item)}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                    {WORKS.filter(
                      (work) => filter === "全部" || work.category === filter,
                    ).map(card)}
                  </>
                ) : view === "search" ? (
                  <>
                    <div className={styles.searchField}>
                      <label
                        className={styles.srOnly}
                        htmlFor="platform-work-search"
                      >
                        搜索测评名称或题材
                      </label>
                      <input
                        id="platform-work-search"
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="搜索测评名称或题材"
                        autoComplete="off"
                      />
                      <button
                        className={styles.lightButton}
                        onClick={() => setQuery("")}
                      >
                        清空
                      </button>
                    </div>
                    <div aria-live="polite">
                      {WORKS.filter(
                        (work) =>
                          !query.trim() ||
                          `${work.name}${work.tag}${work.description}`
                            .toLowerCase()
                            .includes(query.trim().toLowerCase()),
                      ).map(card)}
                      {!WORKS.some(
                        (work) =>
                          !query.trim() ||
                          `${work.name}${work.tag}${work.description}`
                            .toLowerCase()
                            .includes(query.trim().toLowerCase()),
                      ) && <p className={styles.empty}>没有找到相关作品</p>}
                    </div>
                  </>
                ) : (
                  <>
                    <p className={styles.overline}>
                      ANOTHER WORLD · CONCEPT ONLY
                    </p>
                    <article className={styles.previewCard}>
                      <PlatformArtwork
                        src={assets[view]}
                        alt={`${WORKS.find((work) => work.id === view)!.name}概念插画`}
                        className={styles.previewArt}
                      />
                      <div className={styles.cardInfo}>
                        <span className={styles.overline}>
                          筹备中 · 尚未开放购买与体验
                        </span>
                        <h2>{WORKS.find((work) => work.id === view)!.name}</h2>
                        <p>
                          {WORKS.find((work) => work.id === view)!.description}
                        </p>
                      </div>
                    </article>
                    <p className={styles.lead}>
                      这是未来测评的视觉企划，不代表已上线内容。可以返回评测主页，探索目前展示的作品。
                    </p>
                    <a className={styles.lightButton} href={href("home")}>
                      返回评测主页 <ArrowRight size={17} aria-hidden="true" />
                    </a>
                  </>
                )}
              </section>
            </>
          )}
        </div>
        <nav className={styles.bottomNav} aria-label="主导航">
          <a
            aria-current={view !== "mine" ? "page" : undefined}
            href={href("home")}
          >
            <Sparkles size={25} aria-hidden="true" />
            <span>评测主页</span>
          </a>
          <a
            aria-current={view === "mine" ? "page" : undefined}
            href={href("mine")}
          >
            <UserRound size={25} aria-hidden="true" />
            <span>我的</span>
          </a>
        </nav>
        {menu && (
          <PlatformModal title="探索不同的故事" onClose={() => setMenu(false)}>
            <p>平台的导航保持简单，测评内部拥有独立的沉浸体验。</p>
            {(
              [
                ["home", "评测主页"],
                ["catalog", "全部作品"],
                ["mine", "兑换码兑换"],
              ] as const
            ).map(([next, label]) => (
              <a key={next} className={styles.menuRow} href={href(next)}>
                {label}
                <ArrowRight size={18} aria-hidden="true" />
              </a>
            ))}
          </PlatformModal>
        )}
      </div>
    </main>
  );
}
