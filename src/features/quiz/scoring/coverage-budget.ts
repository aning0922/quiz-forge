import { COVERAGE_POLICY } from "@/lib/assessment-contract/scoring-api-v1";
export type BudgetLimits = {
  [
    K in
      | "frontierStates"
      | "retainedStates"
      | "transitions"
      | "coordinateAdditions"
      | "scalarComparisons"
      | "pathBytes"
  ]: number;
};
export type BudgetLimit = keyof BudgetLimits;
export class BudgetExhausted extends Error {
  constructor(readonly limit: BudgetLimit) {
    super("SCORING_COVERAGE_BUDGET");
  }
}
/** Internal accounting component. Public analysis always uses the compiled fixed
 * policy; tests may lower this component's limits without a public override API. */
export class CoverageMeter {
  readonly stats = {
    transitions: 0,
    coordinateAdditions: 0,
    scalarComparisons: 0,
    peakFrontierStates: 0,
    peakRetainedStates: 0,
    peakPathBytes: 0,
  };
  constructor(
    private readonly limits: Readonly<BudgetLimits> = COVERAGE_POLICY,
  ) {}
  take(
    kind: "transitions" | "coordinateAdditions" | "scalarComparisons",
    amount: number,
  ) {
    if (this.stats[kind] + amount > this.limits[kind])
      throw new BudgetExhausted(kind);
    this.stats[kind] += amount;
  }
  reserve(frontierStates: number, retainedStates: number, pathBytes: number) {
    for (const [kind, value] of [
      ["frontierStates", frontierStates],
      ["retainedStates", retainedStates],
      ["pathBytes", pathBytes],
    ] as const)
      if (value > this.limits[kind]) throw new BudgetExhausted(kind);
    this.stats.peakFrontierStates = Math.max(
      this.stats.peakFrontierStates,
      frontierStates,
    );
    this.stats.peakRetainedStates = Math.max(
      this.stats.peakRetainedStates,
      retainedStates,
    );
    this.stats.peakPathBytes = Math.max(this.stats.peakPathBytes, pathBytes);
  }
}
