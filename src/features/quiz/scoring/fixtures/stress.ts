import { scoringDefinitionSchema } from "@/lib/assessment-contract/scoring-api-v1";

/** Bounded independent synthetic models; no production content or authority. */
export function coverageStress(
  kind: "frontier" | "transitions" | "comparisons",
) {
  const productId = "scoring-budget",
    version = "1.0.0";
  const ref = (id: string) => ({ id, productId, version });
  const dimensionCount =
    kind === "comparisons" ? 16 : kind === "frontier" ? 5 : 1;
  const dimensions = Array.from({ length: dimensionCount }, (_, i) =>
    ref(`d-${i}`),
  );
  const questionCount = kind === "transitions" ? 100 : 5;
  const questions = Array.from({ length: questionCount }, (_, qi) => ({
    ref: ref(`q-${qi}`),
    options: Array.from(
      { length: kind === "comparisons" && qi === 4 ? 4 : 8 },
      (_, oi) => ({
        ref: ref(`q-${qi}-o-${oi}`),
        contributions: dimensions.map((dimensionRef, di) => ({
          dimensionRef,
          value:
            kind === "transitions"
              ? [0, 1, 2, 3, 4, 5, 6, 100][oi]!
              : qi === (di < 5 ? di : 0)
                ? oi
                : 0,
        })),
      }),
    ),
  }));
  const resultCount = kind === "comparisons" ? 32 : 2;
  const results = Array.from({ length: resultCount }, (_, i) => ref(`r-${i}`));
  const rules = {
    kind: "dimensions",
    aggregation: "sum",
    tieBreak: "result-order",
    resultOrder: results,
    normalization: {
      kind: "linear-to-0-100",
      bounds: dimensions.map((dimensionRef, di) => ({
        dimensionRef,
        min: 0,
        max:
          kind === "transitions"
            ? 10000
            : kind === "comparisons" && di === 4
              ? 3
              : 7,
      })),
    },
    profiles: results.map((resultRef, ri) => ({
      resultRef,
      ranges: dimensions.map((dimensionRef, di) => ({
        dimensionRef,
        min: kind === "comparisons" && di === 15 && ri < 31 ? 100 : 0,
        max:
          kind === "comparisons" && di === 15 && ri === 31
            ? 99
            : kind !== "comparisons" && ri === 1
              ? 99
              : 100,
      })),
    })),
  };
  return scoringDefinitionSchema.parse({
    schemaVersion: "quiz-scoring-definition.v1",
    productId,
    contentVersion: version,
    engine: { id: "dimensions", version },
    dimensions,
    questions,
    results,
    rules,
  });
}

export const LARGE_PRIME_SPANS = [
  9901, 9907, 9923, 9929, 9931, 9941, 9949, 9967, 9973, 10007, 10009, 10037,
  10039, 10061, 10067, 10069,
];
export function largeDenominatorDefinition() {
  const productId = "scoring-rational",
    version = "1.0.0";
  const ref = (id: string) => ({ id, productId, version });
  const dimensions = LARGE_PRIME_SPANS.map((_v, i) => ref(`d-${i}`));
  // 100 bounded questions; split each span into 100 contributions <= 100.
  // Spans >10000 use a negative minimum so each full span is still <=20000.
  const lows = LARGE_PRIME_SPANS.map((span) => (span > 10000 ? -1 : 0));
  const questions = Array.from({ length: 100 }, (_, qi) => ({
    ref: ref(`q-${qi}`),
    options: [0, 1].map((oi) => ({
      ref: ref(`q-${qi}-o-${oi}`),
      contributions: dimensions.map((dimensionRef, di) => {
        const span = LARGE_PRIME_SPANS[di]!;
        const delta = Math.floor(span / 100) + (qi < span % 100 ? 1 : 0);
        const low = lows[di]!;
        return { dimensionRef, value: oi ? low + delta : low };
      }),
    })),
  }));
  const results = [ref("low"), ref("high")];
  return scoringDefinitionSchema.parse({
    schemaVersion: "quiz-scoring-definition.v1",
    productId,
    contentVersion: version,
    engine: { id: "archetype", version },
    dimensions,
    questions,
    results,
    rules: {
      kind: "archetype",
      aggregation: "sum",
      distance: "squared-euclidean",
      tieBreak: "result-order",
      resultOrder: results,
      normalization: {
        kind: "linear-to-0-100",
        bounds: dimensions.map((dimensionRef, di) => ({
          dimensionRef,
          min: lows[di]! * 100,
          max: lows[di]! * 100 + LARGE_PRIME_SPANS[di]!,
        })),
      },
      profiles: results.map((resultRef, ri) => ({
        resultRef,
        targets: dimensions.map((dimensionRef) => ({
          dimensionRef,
          value: ri * 100,
        })),
      })),
    },
  });
}
