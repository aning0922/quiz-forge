import type { ResultAtlasView } from "./result-atlas";

/** Fixed invented values, never derived from the 12 demo questions. Shared by A and B. */
export const historicalAtlasFixture: ResultAtlasView = {
  kind: "synthetic",
  fixtureId: "historical-atlas-five.v1",
  dimensions: [
    {
      dimensionId: "exploration",
      label: "自主探索",
      normalizedScore: 88,
      displayOrder: 1,
      lowLabel: "循熟悉路径",
      highLabel: "主动开新路",
      interpretation: "愿意先迈出一步，在未知中寻找可能。",
      scaleDescription:
        "越高越偏向自主尝试新路径；较低更偏向借鉴熟悉的经验。两端不代表优劣。",
    },
    {
      dimensionId: "expression",
      label: "创造表达",
      normalizedScore: 82,
      displayOrder: 2,
      lowLabel: "内化感受",
      highLabel: "外化创意",
      interpretation: "喜欢把感受变成文字、作品或新的想法。",
      scaleDescription:
        "越高越偏向主动表达创意；较低更偏向内在消化。不是创造能力的评分。",
    },
    {
      dimensionId: "resonance",
      label: "关系共鸣",
      normalizedScore: 64,
      displayOrder: 3,
      lowLabel: "保留自我空间",
      highLabel: "寻求情感联结",
      interpretation: "期待被理解，也愿意听见他人的感受。",
      scaleDescription:
        "越高越偏向在互动中寻求情感联结；较低更偏向保留个人空间。不是人缘或共情能力排名。",
    },
    {
      dimensionId: "planning",
      label: "审慎规划",
      normalizedScore: 46,
      displayOrder: 4,
      lowLabel: "随情境调整",
      highLabel: "事先做安排",
      interpretation: "为变化留些余地，不急着把每一步定好。",
      scaleDescription:
        "越高越偏向行动前安排；较低更偏向随情境调整。两端都可能适合不同任务。",
    },
    {
      dimensionId: "steadiness",
      label: "稳健执行",
      normalizedScore: 38,
      displayOrder: 5,
      lowLabel: "切换新目标",
      highLabel: "持续同一节奏",
      interpretation: "更容易被新目标吸引，偏好有变化的节奏。",
      scaleDescription:
        "越高越偏向保持既定节奏；较低更偏向切换目标。不是毅力、能力或责任心判断。",
    },
  ],
};

export const atlasSamples = ["four", "five", "seven", "long"] as const;
export type AtlasSample = (typeof atlasSamples)[number];

/** Separate edge fixtures for the research route. They have no character-match meaning. */
export function getAtlasSample(sample: AtlasSample): ResultAtlasView {
  if (sample === "five") return historicalAtlasFixture;
  const expanded = [
    ...historicalAtlasFixture.dimensions,
    {
      dimensionId: "reflection",
      label: "独处沉思",
      normalizedScore: 99.5,
      displayOrder: 6,
      lowLabel: "即时交流",
      highLabel: "独处思考",
      interpretation: "边界演示，不提供性格结论。",
      scaleDescription: "边界布局夹具；分数越高越靠近右端的独处思考意象。",
    },
    {
      dimensionId: "adaptation",
      label: "应变节奏",
      normalizedScore: 100,
      displayOrder: 7,
      lowLabel: "保持原计划",
      highLabel: "灵活应变",
      interpretation: "边界演示，不提供性格结论。",
      scaleDescription: "边界布局夹具；分数越高越靠近右端的灵活应变意象。",
    },
  ];
  const scores =
    sample === "four"
      ? [0, 50, 100, 0.5]
      : [1, 33.33, 49.99, 50, 50.01, 99.5, 100];
  return {
    kind: "synthetic",
    fixtureId: `atlas-${sample}-boundary.v1`,
    dimensions: expanded.slice(0, scores.length).map((dimension, index) => ({
      ...dimension,
      normalizedScore: scores[index]!,
      label:
        sample === "long" && index === 0
          ? "在陌生情境中保持自主探索与重新选择方向的倾向"
          : dimension.label,
      interpretation:
        sample === "long"
          ? "这是一段专用于排版的超长说明：当生活节奏、同行者期待与原先的安排发生变化时，文字应自然换行并保留完整阅读空间，不省略内容，不挤压数字，也不把任何一端描述为更优秀。"
          : "边界显示样本，仅用于检查刻度与文本，不作性格解释。",
    })),
  };
}
