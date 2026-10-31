import type { ComposedReportBodyV1 } from "@/lib/assessment-contract/composed-report-v1";
import type { QianzaiReportPresentation } from "./presentation";

/** Static literary identity from the approved report prototype. This does not
 * supply personalized conclusions, numerical values or answer evidence. */
const LI_BAI = {
  roleRef: { productId: "qianzai-tongxin", id: "li-bai", version: "1.0.0" },
  version: "1.0.0",
  sourceHtmlSha256:
    "3a307beeaea214cba3df1944d53941c887640dcf6f94c4bfd3e1027c36b8a443",
  identity: {
    honorific: "诗仙",
    seal: ["青莲", "居士"],
    tags: ["浪漫", "自由", "想象力", "真性情"],
    verse: {
      text: "我本楚狂人，凤歌笑孔丘。",
      source: "—— 李白《庐山谣寄卢侍御虚舟》",
    },
    lifespan: "701—762 · 唐代诗人",
    courtesyName: "字太白 · 号青莲居士",
  },
  heroCaption: "长风有信，明月知心",
  history: {
    title: "千年之外，仍见其人",
    intro: "相遇千年诗魂，不妨再认识真实的他。",
    timeline: [
      {
        title: "游历山河",
        text: "李白在各地游历，山水与见闻成为诗歌的重要源泉。",
      },
      { title: "长安岁月", text: "唐玄宗天宝年间，曾入长安任翰林供奉。" },
      {
        title: "诗名流传",
        text: "以浪漫奔放、想象奇特的诗风闻名，被后世誉为“诗仙”。",
      },
    ],
    sourceNote:
      "人物事实参照故宫博物院「李白」词条；引诗据《庐山谣寄卢侍御虚舟》原文。\n本页画面为艺术想象，不是历史肖像。",
  },
  sections: [
    {
      id: "encounter",
      title: "命定相逢",
      paragraphs: [{ index: 0, layout: "lead" }],
    },
    {
      id: "dimensions",
      title: "你的心象五维",
      intro: "用五个方向，读懂一种可能的精神共鸣。",
    },
    {
      id: "patterns",
      title: "为何偏偏与你相逢",
      paragraphs: [
        { index: 0, layout: "card" },
        { index: 1, layout: "card" },
        { index: 2, layout: "card" },
      ],
    },
    {
      id: "counterevidence",
      paragraphs: [
        { index: 0, layout: "reflection-quote" },
        { index: 1, layout: "reflection-body" },
        { index: 2, layout: "reflection-body" },
      ],
    },
  ],
} as const satisfies QianzaiReportPresentation;

export function qianzaiRolePresentation(
  ref: ComposedReportBodyV1["matching"]["selected"]["ref"],
) {
  return ref.productId === LI_BAI.roleRef.productId &&
    ref.id === LI_BAI.roleRef.id &&
    ref.version === LI_BAI.roleRef.version
    ? LI_BAI
    : undefined;
}
