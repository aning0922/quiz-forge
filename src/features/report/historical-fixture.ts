import type { HistoricalReportView } from "./historical-view";

/** Independent invented display content. No answers, user data or calculated match. */
export const historicalReportFixture: HistoricalReportView = {
  kind: "synthetic-preview",
  identity: {
    name: "李白",
    title: "浪漫自由的行路者",
    era: "盛唐 · 诗人",
    portraitAssetId: "historical.li-bai.concept",
    shortLine: "将心事，写成远方。",
  },
  dimensions: [
    {
      id: "exploration",
      label: "自主探索",
      tendency: "prominent",
      explanation: "愿意寻找新的可能，也珍视自己选择道路的空间。",
    },
    {
      id: "expression",
      label: "创造表达",
      tendency: "prominent",
      explanation: "容易被灵感点亮，喜欢把感受变成可以分享的表达。",
    },
    {
      id: "connection",
      label: "关系连接",
      tendency: "balanced",
      explanation: "期待理解与回应，也为独处保留一段安静的时间。",
    },
    {
      id: "steadiness",
      label: "稳步执行",
      tendency: "reserved",
      explanation: "比起重复的安排，更容易被新鲜目标吸引。",
    },
  ],
  rationale: {
    summary:
      "这份合成示例把“探索与表达”放在前景，用“行路者”的文化意象连接人物卡与性情解读。",
    basis: [
      {
        label: "倾向摘要",
        explanation: "示例中的探索与表达较突出，连接居中，执行较内敛。",
      },
      {
        label: "意象对应",
        explanation: "诗意、远方与自主选择，共同构成这张概念卡的叙事。",
      },
    ],
  },
  strengths: [
    "能在平常事物里发现新鲜的角度。",
    "愿意表达真实感受，让想法被别人看见。",
  ],
  tradeoffs: [
    "新灵感很多时，可能难以持续完成同一个目标。",
    "直率表达前，多留一点倾听的空间。",
  ],
  similarPeople: [
    { name: "苏轼", reason: "合成比较维度：表达与生活感受。" },
    { name: "陶渊明", reason: "合成比较维度：自主选择与安静生活。" },
  ],
  culture: {
    heading: "人物的时代，与文化意象",
    text: "正式介绍将独立承载人物的时代、经历与文化背景，并附可追溯来源。当前借“盛唐诗人、行路与自由”的文化意象展示排版；这里没有对真实历史人物性格作定论。",
    sourceStatus: "editorial-pending",
  },
  poster: {
    title: "李白 · 浪漫自由的行路者",
    shortLine: "将心事，写成远方。",
    attribution: "千载同心 / QUIZFORGE",
    disclosure: "娱乐性格测评 · 合成预览 · 非心理诊断",
  },
};
