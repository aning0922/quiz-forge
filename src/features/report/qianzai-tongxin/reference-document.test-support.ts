/** Verbatim visual comparison data extracted from the supplied report HTML.
 * REFERENCE ONLY: never imported by runtime scoring, snapshots or registrations. */
import type { QianzaiReferenceDocument } from "./presentation";
export const QIANZAI_REFERENCE_REPORT_HTML_SHA256 =
  "3a307beeaea214cba3df1944d53941c887640dcf6f94c4bfd3e1027c36b8a443";
export const QIANZAI_REFERENCE_SHARE_HTML_SHA256 =
  "05cf28cf7cae5aa135470ba513018c4c08a205358fa2b9ec0ed3ab0e2d35f12c";
export const qianzaiReferenceDocument = {
  mode: "reference-only",
  sourceHtmlSha256: QIANZAI_REFERENCE_REPORT_HTML_SHA256,
  name: "李白",
  subtitle: "与你同心的，是心向山河的那份自由",
  identity: {
    honorific: "诗仙",
    seal: ["青莲", "居士"],
    tags: ["浪漫", "自由", "想象力", "真性情"],
    lifespan: "701—762 · 唐代诗人",
    courtesyName: "字太白 · 号青莲居士",
  },
  heroCaption: "长风有信，明月知心",
  openingTitle: "命定相逢",
  openingNote: "✧ 本页为李白固定角色的视觉演示；不代表正式测评结果",
  dimensions: [
    {
      dimensionRef: {
        productId: "qztx-reference-only",
        id: "axis-0",
        version: "1",
      },
      label: "创造力",
      score: 95,
    },
    {
      dimensionRef: {
        productId: "qztx-reference-only",
        id: "axis-1",
        version: "1",
      },
      label: "行动力",
      score: 82,
    },
    {
      dimensionRef: {
        productId: "qztx-reference-only",
        id: "axis-2",
        version: "1",
      },
      label: "社交力",
      score: 78,
    },
    {
      dimensionRef: {
        productId: "qztx-reference-only",
        id: "axis-3",
        version: "1",
      },
      label: "情感力",
      score: 88,
    },
    {
      dimensionRef: {
        productId: "qztx-reference-only",
        id: "axis-4",
        version: "1",
      },
      label: "思考力",
      score: 90,
    },
  ],
  dimensionBadge: "DEMO · 示例数值",
  dimensionInsight: {
    title: "当想象遇见勇气",
    text: "图形展示了五维画像的阅读方式。正式分值和解释将由评分模型与锁定报告提供。",
  },
  dimensionWarning:
    "以上 95 / 90 / 88 / 82 / 78 均为排版测试数值，并非你的答题得分。",
  sections: [
    {
      id: "encounter",
      title: "命定相逢",
      blocks: [
        {
          layout: "verse",
          text: "我本楚狂人，凤歌笑孔丘。",
          citation: "—— 李白《庐山谣寄卢侍御虚舟》",
        },
        {
          layout: "lead",
          text: "你与他的相似，不是经历同一种人生，而是或许都愿意在寻常日子里，守住一点热烈、一点好奇，和不被轻易磨灭的诗意。",
        },
      ],
    },
    {
      id: "dimensions",
      title: "你的心象五维",
      intro: "用五个方向，读懂一种可能的精神共鸣。",
      blocks: [],
    },
    {
      id: "patterns",
      title: "为何偏偏与你相逢",
      intro: "不是一句“你像李白”，而是细读那几缕相似的光。",
      blocks: [
        {
          layout: "card",
          title: "心有所向，便有远方",
          text: "也许你会被未知的风景与新的可能打动。真正吸引你的，不只是目的地，还有出发时那份自由。",
          citation: "「长风几万里，吹度玉门关。」",
        },
        {
          layout: "card",
          title: "真心不必藏于言外",
          text: "在喧闹和评价之外，你仍珍惜坦荡的表达。比起处处符合期待，更愿意留一处可以做自己的天地。",
          citation: "心有山海，不必为俗声所困",
        },
        {
          layout: "card",
          title: "平凡日子亦有诗意",
          text: "一轮月色、一段旅途、一句旧诗，可能都能让你重新看见生活里的光。感受力是你与世界温柔相认的方式。",
          citation: "「举头望明月，低头思故乡。」",
        },
      ],
      note: "这些段落是待验证的示例共鸣文案，正式报告需与具体答题依据对应。",
    },
    {
      id: "counterevidence",
      title: "山河辽阔，也要安放心",
      intro: "与一个人共鸣，不意味着必须复刻他的命运。",
      blocks: [
        {
          layout: "reflection-quote",
          text: "愿你敢向远方，也能在风起之时，照顾好脚下的路。",
        },
        {
          layout: "reflection-body",
          text: "理想与现实之间，总有些距离。你可以保有诗意，也为热爱安排耐心；可以勇于表达，也认真听见他人的声音。",
        },
        {
          layout: "prompt",
          title: "照见自己",
          text: "什么时刻最让你感到自由？",
        },
        {
          layout: "prompt",
          title: "留给明天",
          text: "从一件小事出发，亲手打开新可能。",
        },
      ],
    },
    {
      id: "literature",
      chapterLabel: "伍 · 诗仙小传",
      tocTitle: "伍 · 诗仙小传",
      title: "诗仙小传 · 李白",
      intro: "相遇千年诗魂，不妨再认识真实的他。",
      blocks: [
        {
          layout: "timeline",
          title: "游历山河",
          text: "李白在各地游历，山水与见闻成为诗歌的重要源泉。",
        },
        {
          layout: "timeline",
          title: "长安岁月",
          text: "唐玄宗天宝年间，曾入长安任翰林供奉。",
        },
        {
          layout: "timeline",
          title: "诗名流传",
          text: "以浪漫奔放、想象奇特的诗风闻名，被后世誉为“诗仙”。",
        },
        {
          layout: "source",
          text: "人物事实参照故宫博物院「李白」词条；引诗据《庐山谣寄卢侍御虚舟》原文。\n本页画面为艺术想象，不是历史肖像。",
        },
      ],
    },
    {
      id: "closure",
      title: "寄语留存",
      blocks: [
        {
          layout: "final-verse",
          text: "山河有尽\n同心无涯",
        },
        {
          layout: "body",
          text: "愿你经过人间烟火，仍愿抬头看月亮；\n走过各自山海，始终保留出发的勇气。",
        },
      ],
    },
  ],
  legal:
    "长报告视觉研究 · 李白为固定演示结果\n无正式评分、真实报告快照及生产级海报能力",
} as const satisfies QianzaiReferenceDocument;
