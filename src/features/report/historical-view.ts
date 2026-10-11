/** D1-A.1 read-only presentation proposal. Not a scoring or persisted report schema. */
export interface HistoricalReportView {
  readonly kind: "synthetic-preview";
  readonly identity: {
    readonly name: string;
    readonly title: string;
    readonly era: string;
    readonly portraitAssetId: string;
    readonly shortLine: string;
  };
  readonly dimensions: readonly {
    readonly id: string;
    readonly label: string;
    readonly tendency: "prominent" | "balanced" | "reserved";
    readonly explanation: string;
  }[];
  readonly rationale: {
    readonly summary: string;
    readonly basis: readonly {
      readonly label: string;
      readonly explanation: string;
    }[];
  };
  readonly strengths: readonly string[];
  readonly tradeoffs: readonly string[];
  readonly similarPeople: readonly {
    readonly name: string;
    readonly reason: string;
  }[];
  readonly culture: {
    readonly heading: string;
    readonly text: string;
    readonly sourceStatus: "editorial-pending";
  };
  readonly poster: {
    readonly title: string;
    readonly shortLine: string;
    readonly attribution: string;
    readonly disclosure: string;
  };
}
