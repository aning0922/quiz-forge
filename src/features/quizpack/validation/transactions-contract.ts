import "server-only";
import type { P2aDatabase } from "@/lib/db/client";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import type {
  CandidateFacts,
  DeepReadonly,
} from "../server/validation/private-candidate";
import type { ValidationErrorCode } from "./contracts";
import type {
  ValidationAttempt,
  ValidationBinding,
  ValidationRow,
} from "./repository";
export type ValidationScope = Readonly<{ productId: string; importId: string }>;
export type ValidationOwner = Readonly<{
  ownerPid: number;
  ownerNonce: string;
}>;
export type ValidationAuthority = Readonly<{
  validationId: string;
  expectedStateRevision: number;
  fence: number;
  attemptId: string;
}>;
/** Raw canonical texts from A's serializer; never reconstructed from jsonb output. */
export type EvidenceProjection = Readonly<{
  evidenceText: string | null;
  evidenceSha256: string | null;
  reportTexts: readonly string[];
  metadataText: string | null;
  attemptsControlText: string;
}>;
export type FrozenCandidate = Readonly<{
  facts: DeepReadonly<CandidateFacts & { assetSetText: string }>;
  manifestSha256: string;
  contentSha256: string;
}>;
export type ClaimValidationInput = Readonly<{
  expectedImportStateRevision: number;
  expectedValidationKey: string;
  binding: ValidationBinding;
  owner: ValidationOwner;
}>;
export type ClaimValidationResult = Readonly<{
  row: ValidationRow;
  created: boolean;
}>;
export type AppendEvidenceInput = Readonly<{
  authority: ValidationAuthority;
  projection: EvidenceProjection;
  mediaStop: "not-started" | "confirmed" | "unconfirmed";
  candidate: FrozenCandidate | null;
  outcome: "accepted" | "rejected" | "interrupted";
  errorCode: ValidationErrorCode | null;
}>;
export type BlobFact = Readonly<{
  sha256: string;
  bytes: number;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  frames: 1;
}>;
export type CompleteValidationInput = Readonly<{
  authority: ValidationAuthority;
  blobs: readonly BlobFact[];
  accountedBytes: number;
}>;
/** Read only from settled managed IO/receipt proof; SQL cannot authenticate native stopping. */
export type SettledAttempt = Readonly<{
  attemptId: string;
  mediaStop: "not-started" | "confirmed";
}>;
export type ReconcileValidationInput = Readonly<{
  authority: ValidationAuthority;
  settledAttempts: readonly SettledAttempt[];
  accountedBytes: number;
  storageCondition: "clean" | "cleanup-required" | "unknown";
  errorCode: ValidationErrorCode | null;
}>;
export type RetryValidationInput = Readonly<{
  expectedStateRevision: number;
  binding: ValidationBinding;
  owner: ValidationOwner;
}>;
/** Every mutation starts a fresh current-auth transaction, then locks Product→import→validation. No IO callbacks. */
export interface ValidationTransactions {
  claimValidation(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    scope: ValidationScope,
    input: ClaimValidationInput,
  ): Promise<ClaimValidationResult>;
  appendValidationEvidence(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    scope: ValidationScope,
    input: AppendEvidenceInput,
  ): Promise<ValidationRow>;
  beginArchiving(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    scope: ValidationScope,
    authority: ValidationAuthority,
  ): Promise<ValidationRow>;
  completeValidation(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    scope: ValidationScope,
    input: CompleteValidationInput,
  ): Promise<ValidationRow>;
  interruptValidation(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    scope: ValidationScope,
    input: ReconcileValidationInput,
  ): Promise<ValidationRow>;
  recoverValidationClaim(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    scope: ValidationScope,
    input: ReconcileValidationInput,
  ): Promise<ValidationRow>;
  retryValidationClaim(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    scope: ValidationScope,
    validationId: string,
    input: RetryValidationInput,
  ): Promise<ValidationRow>;
}
export type { ValidationAttempt };
