import "server-only";
export { validateArchiveCandidate } from "./engine";

export {
  candidateResultEvidenceSchema,
  evidenceEnvelopeSchema,
  validationIdentitySchema,
  sealCandidateResultEvidence,
  sealEvidenceEnvelope,
} from "./contracts";
export type {
  CandidateEvidence,
  CandidateResultEvidence,
  EvidenceEnvelope,
  ValidationIdentity,
} from "./contracts";
export type {
  CandidateResult,
  CandidateFacts,
  PrivateArchiveCandidate,
} from "./private-candidate";
export { copyCandidateResourceBytes } from "./private-candidate";
export {
  strictP1ReportSchema,
  sealP1Report,
  serializeSealedReport,
  EVIDENCE_LIMITS,
  REPORT_SCHEMA_HASH,
} from "./report";
export {
  PERSISTENCE_UNICODE_POLICY_HASH,
  assertPersistenceUnicode,
} from "./unicode";
export {
  prepareValidationIdentity,
  preparedIdentityEvidenceSchema,
} from "./prepared";
export { serializeEvidenceSqlProjection } from "./sql-projection";
export type {
  PreparedValidationIdentity,
  PreparedIdentityResult,
  FrozenValidationEvidence,
  ExpectedCandidateFacts,
  RestoreCandidateInput,
  RestoreResult,
  RestoreValidatedCandidate,
  EvidenceSqlProjection,
  EvidenceSqlProjectionResult,
} from "./adapter-types";
