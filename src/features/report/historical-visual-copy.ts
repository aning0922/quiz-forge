/** Read-only editorial display proposal. Character prose belongs to a future snapshot. */
export interface HistoricalVisualCopy {
  readonly reportHeadline: string;
  readonly oneLineResult: string;
  readonly seal: string;
  readonly englishTitle: string;
  readonly revealLead: {
    readonly journey: string;
    readonly collection: string;
  };
  readonly revealClosing: string;
  readonly strengthHeading: string;
  readonly tradeoffHeading: string;
  readonly matchNotes: readonly {
    readonly title: string;
    readonly dimensionIds: readonly string[];
    readonly explanation: string;
  }[];
  readonly posterDimensions: readonly {
    readonly dimensionId: string;
    readonly shortLabel: string;
  }[];
}

export const historicalVisualCopyFixture: HistoricalVisualCopy = {
  reportHeadline: "心有旷野，\n行路自有光。",
  oneLineResult: "探索与表达为先，为变化留白。",
  seal: "逸",
  englishTitle: "THE WANDERING SOUL",
  revealLead: {
    journey: "山河之间，遇见自由的回声。",
    collection: "翻开这一页，看见一种风骨。",
  },
  revealClosing: "心有远方，也自有方向。",
  strengthHeading: "给灵感一个出口",
  tradeoffHeading: "让热爱走得更远",
  matchNotes: [
    {
      title: "为什么用这个人物意象？",
      dimensionIds: ["exploration", "expression"],
      explanation:
        "这份合成示例把探索与表达放在前景，以行路、诗意和自主选择连接李白这一文化意象。数值与人物关系均为编辑示例，没有计算匹配。",
    },
    {
      title: "另一面，也值得被看见",
      dimensionIds: ["planning", "steadiness"],
      explanation:
        "两项示意值更靠近随情境调整与切换目标的一端，补充了偏好变化的侧面；不能据此推断执行能力，也不意味着较低就是短板。",
    },
  ],
  posterDimensions: [
    { dimensionId: "exploration", shortLabel: "探索" },
    { dimensionId: "expression", shortLabel: "表达" },
  ],
};
