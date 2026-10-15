import {
  COVERAGE_POLICY,
  COVERAGE_POLICY_HASH,
  SCORING_API_LIMITS,
  coverageEvidenceSchema,
  type CoverageEvidenceV1,
  type ScoringResult,
} from "@/lib/assessment-contract/scoring-api-v1";
import type { PreparedScoringDefinition } from "./contracts";
import { compiled } from "./prepare";
import { failure, output } from "./boundary";
import { scoreCompleteAnswers } from "./score";
import { CoverageMeter, BudgetExhausted } from "./coverage-budget";

type State = { raw: readonly number[]; path: Uint8Array };
export function analyzeDimensionsCoverage(
  handle: PreparedScoringDefinition,
): ScoringResult<CoverageEvidenceV1> {
  const c = compiled(handle);
  if (!c) return failure("INVALID_PREPARED_DEFINITION");
  const rules = c.definition.rules;
  if (rules.kind !== "dimensions")
    return failure("UNSUPPORTED_COVERAGE_ENGINE");
  const meter = new CoverageMeter();
  let processedQuestions = 0;
  const emit = (branch: object): ScoringResult<CoverageEvidenceV1> =>
    output(
      coverageEvidenceSchema,
      {
        schemaVersion: "quiz-coverage-evidence.v1",
        logicHash: c.identity.logicHash,
        policyId: COVERAGE_POLICY.id,
        policyHash: COVERAGE_POLICY_HASH,
        budget: COVERAGE_POLICY,
        processedQuestions,
        stats: meter.stats,
        ...branch,
      },
      SCORING_API_LIMITS.evidenceBytes,
    );
  try {
    const last = rules.profiles[rules.profiles.length - 1]!;
    let global = true;
    for (const range of last.ranges) {
      meter.take("scalarComparisons", 2);
      const lower = range.min === 0,
        upper = range.max === 100;
      if (!(lower && upper)) {
        global = false;
        break;
      }
    }
    if (global)
      return emit({
        status: "proven",
        proof: { kind: "last-global-profile", resultRef: last.resultRef },
      });
    meter.reserve(1, 1, 0);
    let frontier = new Map<string, State>([
      [
        c.minima.map(() => 0).join(","),
        { raw: c.minima.map(() => 0), path: new Uint8Array(0) },
      ],
    ]);
    for (const [qi, question] of c.definition.questions.entries()) {
      const next = new Map<string, State>();
      for (const state of frontier.values())
        for (const [oi, option] of question.options.entries()) {
          meter.take("transitions", 1);
          meter.take("coordinateAdditions", c.definition.dimensions.length);
          const vector = c.lookupOption(option.ref.id)!.values;
          const raw = state.raw.map((v, di) => v + vector[di]!);
          const key = raw.join(",");
          if (next.has(key)) continue;
          meter.reserve(
            next.size + 1,
            frontier.size + next.size + 1,
            frontier.size * qi + (next.size + 1) * (qi + 1),
          );
          // Allocate the representative only after deduplication and all checks.
          const path = new Uint8Array(qi + 1);
          path.set(state.path);
          path[qi] = oi;
          next.set(key, { raw, path });
        }
      frontier = next;
      processedQuestions = qi + 1;
    }
    for (const state of frontier.values()) {
      const scalarStart = meter.stats.scalarComparisons;
      let matched = false;
      for (const profile of rules.profiles) {
        let profileMatch = true;
        for (const [di, range] of profile.ranges.entries()) {
          meter.take("scalarComparisons", 2);
          const n = BigInt(100) * BigInt(state.raw[di]! - c.minima[di]!);
          const span = BigInt(c.maxima[di]! - c.minima[di]!);
          const lower = n >= BigInt(range.min) * span;
          const upper = n <= BigInt(range.max) * span;
          if (!(lower && upper)) {
            profileMatch = false;
            break;
          }
        }
        if (profileMatch) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        // The public scorer repeats the same deterministic range traversal.
        // Reserve its arithmetic before allocating or executing the proof.
        meter.take(
          "coordinateAdditions",
          c.definition.questions.length * c.definition.dimensions.length,
        );
        meter.take(
          "scalarComparisons",
          meter.stats.scalarComparisons - scalarStart,
        );
        const normalizedAnswers = c.definition.questions.map((q, qi) => ({
          questionId: q.ref.id,
          optionId: q.options[state.path[qi]!]!.ref.id,
        }));
        const verified = scoreCompleteAnswers(handle, normalizedAnswers);
        if (
          verified.ok ||
          !verified.issues.every((i) => i.code === "NO_PROFILE_MATCH")
        )
          return failure("INVALID_DEFINITION");
        return emit({
          status: "uncovered",
          counterexample: {
            normalizedAnswers,
            rawSums: c.definition.dimensions.map((dimensionRef, di) => ({
              dimensionRef,
              rawSum: state.raw[di]!,
            })),
          },
        });
      }
    }
    return emit({
      status: "proven",
      proof: {
        kind: "exhaustive-reachable-vectors",
        reachableVectorCount: frontier.size,
      },
    });
  } catch (error) {
    if (error instanceof BudgetExhausted)
      return emit({ status: "inconclusive", limit: error.limit });
    throw error;
  }
}
