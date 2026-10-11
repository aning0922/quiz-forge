export const artDirections = ["landscape", "celestial"] as const;
export type ArtDirection = (typeof artDirections)[number];
export type ArtView = "reveal" | "report" | "poster";

/** Local, reviewed-code asset registry. Never resolves an arbitrary URL from result data. */
export const artRecipes = {
  landscape: {
    title: "山河入怀",
    subtitle: "沉浸式山河人物画",
    edition: "山河卷 / LANDSCAPE",
    src: "/assets/themes/historical/visual-v2-b/li-bai-landscape.webp",
    alt: "李白艺术化概念：白衣行旅者立于江畔岩台，晨光穿过远山与云雾，衣袍与近景松枝随风展开。",
    action: "展开性情长卷",
    baseline: "journey",
  },
  celestial: {
    title: "风骨映月",
    subtitle: "东方幻想收藏图鉴",
    edition: "风骨录 / CELESTIAL",
    src: "/assets/themes/historical/visual-v2-b/li-bai-celestial.webp",
    alt: "李白艺术化幻想概念：身着月白与靛蓝绣袍的诗人持玉杯，金色月轮、远处楼阁与近景云绢围绕人物。",
    action: "翻阅人物图鉴",
    baseline: "collection",
  },
} as const;

export function artPath(direction: ArtDirection, view: ArtView, query = "") {
  return `/studies/visual-v2-b/${direction}/${view}${query}`;
}
