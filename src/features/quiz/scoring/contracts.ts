import type {
  CoverageEvidenceV1,
  ScoringIdentity,
  ScoringResult,
  ScoreSnapshotV1,
  WitnessEvidenceV1,
} from "@/lib/assessment-contract/scoring-api-v1";

declare const preparedScoringIdentity: unique symbol;
/** The implementation must also verify a private WeakMap-issued identity. */
export type PreparedScoringDefinition = Readonly<{
  [preparedScoringIdentity]: true;
}>;
export interface ScoringApiV1 {
  prepareScoringDefinition(
    input: unknown,
  ): ScoringResult<PreparedScoringDefinition>;
  readScoringIdentity(
    prepared: PreparedScoringDefinition,
  ): ScoringResult<ScoringIdentity>;
  scoreCompleteAnswers(
    prepared: PreparedScoringDefinition,
    answers: unknown,
  ): ScoringResult<ScoreSnapshotV1>;
  verifyDeclaredWitnesses(
    prepared: PreparedScoringDefinition,
    input: unknown,
  ): ScoringResult<WitnessEvidenceV1>;
  analyzeDimensionsCoverage(
    prepared: PreparedScoringDefinition,
  ): ScoringResult<CoverageEvidenceV1>;
}
