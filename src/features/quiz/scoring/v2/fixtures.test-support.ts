import { scoringDefinitionV2Schema } from "@/lib/assessment-contract/scoring-v2";

export const syntheticRef = (id: string) => ({
  id,
  productId: "synthetic-v2",
  version: "1.0.0",
});
export function syntheticV2(axes = 2, count = axes) {
  const r = syntheticRef;
  const dims = Array.from({ length: axes }, (_, i) => r(`axis-${i}`));
  return scoringDefinitionV2Schema.parse({
    schemaVersion: "quiz-scoring-definition.v2",
    productId: "synthetic-v2",
    contentVersion: "1.0.0",
    engine: { id: "archetype-l1", version: "1.0.0" },
    dimensions: dims.map((ref, i) => ({
      ref,
      min:
        -2 *
        Array.from({ length: count }, (_, q) => q).filter((q) => q % axes === i)
          .length,
      max:
        2 *
        Array.from({ length: count }, (_, q) => q).filter((q) => q % axes === i)
          .length,
    })),
    questions: Array.from({ length: count }, (_, q) => ({
      ref: r(`q-${q}`),
      options: [-2, 0, 2].map((value, oi) => ({
        ref: r(`q-${q}-o-${oi}`),
        contributions: dims.map((dimensionRef, i) => ({
          dimensionRef,
          value: q % axes === i ? value : 0,
        })),
      })),
    })),
    profiles: ["first", "second"].map((name, i) => ({
      resultRef: r(name),
      stableRankKey: i ? "a_second" : "z_first",
      sex: i ? "female" : "male",
      kind: "documented-historical",
      targets: dims.map((dimensionRef) => ({ dimensionRef, value: 50 })),
    })),
    matchingPolicy: {
      ref: r("pool"),
      allowedKinds: ["documented-historical", "literary-legendary"],
    },
    rules: {
      normalization: "linear-to-0-100",
      rounding: "ties-to-even-integer",
      distance: "mean-l1",
      tieBreak: "stable-rank-key-ascii",
      nearTieMeanGap: 4,
      index: "clamp-round-even-100-minus-1.5-distance",
    },
  });
}
export const syntheticInputV2 = (
  count = 2,
  choices = Array<number>(count).fill(1),
  preference = "any",
) => ({
  schemaVersion: "quiz-scoring-input.v2",
  answers: choices.map((option, q) => ({
    questionId: `q-${q}`,
    optionId: `q-${q}-o-${option}`,
  })),
  matchingContext: {
    schemaVersion: "quiz-matching-context.v1",
    preference,
    policyRef: syntheticRef("pool"),
  },
});
