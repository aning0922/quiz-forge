import { scoringDefinitionSchema } from "@/lib/assessment-contract/scoring-api-v1";

/** Independent arithmetic fixture. No QuizPack, resource or approval authority. */
export function syntheticDefinition(
  kind: "dimensions" | "archetype" = "archetype",
) {
  const productId = "scoring-synthetic",
    version = "1.0.0";
  const ref = (id: string) => ({ id, productId, version });
  const dimensions = [ref("first"), ref("second")],
    results = [ref("low"), ref("high")];
  const normalization = {
    kind: "linear-to-0-100",
    bounds: dimensions.map((dimensionRef) => ({
      dimensionRef,
      min: -2,
      max: 2,
    })),
  };
  return scoringDefinitionSchema.parse({
    schemaVersion: "quiz-scoring-definition.v1",
    productId,
    contentVersion: version,
    engine: { id: kind, version },
    dimensions,
    results,
    questions: [0, 1].map((q) => ({
      ref: ref(`q-${q}`),
      options: [-2, 0, 2].map((value, oi) => ({
        ref: ref(`q-${q}-o-${oi}`),
        contributions: dimensions.map((dimensionRef, di) => ({
          dimensionRef,
          value: q === di ? value : 0,
        })),
      })),
    })),
    rules: {
      kind,
      aggregation: "sum",
      normalization,
      tieBreak: "result-order",
      resultOrder: results,
      ...(kind === "archetype"
        ? {
            distance: "squared-euclidean",
            profiles: results.map((resultRef, ri) => ({
              resultRef,
              targets: dimensions.map((dimensionRef) => ({
                dimensionRef,
                value: ri * 100,
              })),
            })),
          }
        : {
            profiles: results.map((resultRef, ri) => ({
              resultRef,
              ranges: dimensions.map((dimensionRef) => ({
                dimensionRef,
                min: ri ? 50 : 0,
                max: ri ? 100 : 50,
              })),
            })),
          }),
    },
  });
}
export const syntheticAnswers = (first = 1, second = first) => [
  { questionId: "q-0", optionId: `q-0-o-${first}` },
  { questionId: "q-1", optionId: `q-1-o-${second}` },
];
