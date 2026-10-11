import type {
  InscriptionCandidate,
  TemperamentInscription,
} from "./temperament-inscription";

export const historicalInscriptionCandidates: readonly InscriptionCandidate[] =
  [
    {
      forArchetypes: ["historical.li-bai"],
      relevantDimensionIds: ["exploration", "expression"],
      editorialIntent: "以向远方的意愿呼应探索与表达，不推断用户经历。",
      inscription: {
        id: "li-bai-xing-lu-nan-1.excerpt.v1",
        kind: "classical",
        lines: ["长风破浪会有时，", "直挂云帆济沧海。"],
        posterLine: "直挂云帆济沧海。",
        author: "李白",
        work: "行路难·其一",
        source: {
          title: "南通大学《李白〈行路难〉（其一）鉴赏》诗文正文",
          url: "https://sxss.ntu.edu.cn/2018/0301/c6266a165818/page.htm",
          verifiedOn: "2026-10-11",
        },
        interpretation:
          "借向远方的意愿，呼应本例中的探索与表达；诗句是文化题签，不是对经历或未来的判断。",
      },
    },
    {
      forArchetypes: ["historical.li-bai"],
      relevantDimensionIds: ["exploration", "resonance"],
      editorialIntent: "以松风与星月表现自主行路、感受世界的另一组候选。",
      inscription: {
        id: "original-pine-wind.v1",
        kind: "original",
        lines: ["借得松风开远意，", "且将星月作行囊。"],
        posterLine: "且将星月作行囊。",
        credit: "QuizForge · AI草拟",
        interpretation:
          "把探索的兴致与感受世界的细腻放在一起。这是原创拟古题句，不是古人作品，也没有动态匹配。",
      },
    },
  ];

export const inscriptionVariants = ["classical", "original", "none"] as const;
export type InscriptionVariant = (typeof inscriptionVariants)[number];

/** Explicit research choice only; does not inspect answers, scores, time or randomness. */
export function getStudyInscription(
  variant: InscriptionVariant,
): TemperamentInscription | null {
  if (variant === "none") return null;
  return historicalInscriptionCandidates.find(
    (candidate) => candidate.inscription.kind === variant,
  )!.inscription;
}
