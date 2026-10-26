import type { MediaOperationContext, LaunchFailureCode } from "../media";
import type { ValidationIdentity } from "./contracts";
import type { ValidationCompletion } from "./operation-scope";
import type { PrivateArchiveCandidate } from "./private-candidate";
import type { EvidenceFailureCode } from "./unicode";
import type { PreparedValidationIdentity } from "./prepared";
export type { PreparedValidationIdentity };
export const PREPARE_INTERRUPTION_CODES = [
  "INVALID_CONTEXT",
  "RUNTIME_IDENTITY_UNAVAILABLE",
  "OPERATION_CANCELLED",
  "OPERATION_TIMEOUT",
  "MEDIA_RUNTIME_FAILED",
  "MEDIA_STOP_UNCONFIRMED",
  "RELATED_IO_UNCONFIRMED",
  "BRIDGE_INTERNAL_FAILED",
] as const;
export type PreparedIdentityResult =
  | Readonly<{
      outcome: "prepared";
      identity: ValidationIdentity;
      prepared: PreparedValidationIdentity;
      completion: Readonly<{
        mediaStopped: "not-started";
        relatedIo: "settled";
        maintenanceRequired: false;
      }>;
      runtimeFailure: null;
    }>
  | Readonly<{
      outcome: "interrupted";
      code: (typeof PREPARE_INTERRUPTION_CODES)[number];
      completion: ValidationCompletion;
      runtimeFailure: LaunchFailureCode | null;
    }>;
export type FrozenValidationEvidence = Readonly<{
  evidenceText: string;
  evidenceSha256: string;
  reportTexts: readonly string[];
  metadataText: string;
  attemptsControlText: string;
}>;
/** All values originate from one authoritative repository row, never an HTTP body. */
export type ExpectedCandidateFacts = Readonly<{
  archiveSha256: string;
  archiveBytes: number;
  productId: string;
  packId: string;
  packVersion: string;
  containerSchemaVersion: "quizpack.v1";
  contentSchemaVersion:
    "quizpack-content.v1" | "quizpack-content.v2" | "quizpack-content.v3";
  contentKind: "synthetic" | "authored";
  /** SHA256 of exact original ZIP JSON entry bytes. */
  manifestSha256: string;
  contentSha256: string;
  canonicalManifestText: string;
  canonicalManifestSha256: string;
  canonicalContentText: string;
  canonicalContentSha256: string;
  assetSetText: string;
  assetSetSha256: string;
  candidateSha256: string;
  resourceCount: number;
}>;
export type RestoreCandidateInput = Readonly<{
  prepared: PreparedValidationIdentity;
  frozenEvidence: FrozenValidationEvidence;
  expectedFacts: ExpectedCandidateFacts;
}>;
export const RESTORE_UNAVAILABLE_CODES = [
  "REVALIDATION_REQUIRED",
  "FROZEN_EVIDENCE_INVALID",
  "FROZEN_FACTS_MISMATCH",
  "ARCHIVE_BINDING_MISMATCH",
] as const;
export const RESTORE_INTERRUPTION_CODES = [
  "INVALID_CONTEXT",
  "OPERATION_CANCELLED",
  "OPERATION_TIMEOUT",
  "RELATED_IO_UNCONFIRMED",
  "BRIDGE_INTERNAL_FAILED",
] as const;
export type RestoreResult =
  | Readonly<{
      outcome: "restored";
      candidate: PrivateArchiveCandidate;
      completion: Readonly<{
        mediaStopped: "not-started";
        relatedIo: "settled";
        maintenanceRequired: false;
      }>;
    }>
  | Readonly<{
      outcome: "unavailable";
      code: (typeof RESTORE_UNAVAILABLE_CODES)[number];
      completion: ValidationCompletion;
    }>
  | Readonly<{
      outcome: "interrupted";
      code: (typeof RESTORE_INTERRUPTION_CODES)[number];
      completion: ValidationCompletion;
    }>;
export type EvidenceSqlProjection = Readonly<{
  evidenceText: string | null;
  evidenceSha256: string | null;
  reportTexts: readonly string[];
  metadataText: string | null;
  attemptsControlText: string;
  measuredBytes: Readonly<{
    envelope: number;
    reportPayload: number;
    metadata: number;
    attemptControls: number;
  }>;
}>;
export type EvidenceSqlProjectionResult =
  | Readonly<{ ok: true; value: EvidenceSqlProjection }>
  | Readonly<{ ok: false; code: EvidenceFailureCode }>;
/** Function type can be consumed before the implementation milestone without a fake runtime stub. */
export type RestoreValidatedCandidate = (
  archive: Uint8Array,
  input: RestoreCandidateInput,
  context: MediaOperationContext,
) => Promise<RestoreResult>;
