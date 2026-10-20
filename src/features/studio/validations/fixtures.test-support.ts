import type { PendingStorage, PendingTuple } from "./pending";
import type { ValidationDto } from "@/features/quizpack/validation/contracts";
export const tuple: PendingTuple = {
  productId: "synthetic-validation",
  importId: "00000000-0000-0000-0000-000000000001",
  expectedImportStateRevision: 7,
  archiveSha256: "a".repeat(64),
  archiveBytes: 123,
  identitySha256: "b".repeat(64),
  expectedValidationKey: "c".repeat(64),
};
export const dto: ValidationDto = {
  id: "00000000-0000-0000-0000-000000000002",
  productId: tuple.productId,
  importId: tuple.importId,
  validationKey: tuple.expectedValidationKey,
  stateRevision: 2,
  status: "validating",
  readOnly: false,
  storageCondition: "unknown",
  lastErrorCode: null,
  attemptCount: 1,
  remainingAttempts: 2,
  maintenanceRequired: true,
  archiveSha256: tuple.archiveSha256,
  archiveBytes: tuple.archiveBytes,
  identitySha256: tuple.identitySha256,
  validatorBundleSha256: "d".repeat(64),
  packId: null,
  packVersion: null,
  containerSchemaVersion: null,
  contentSchemaVersion: null,
  identityKind: "unclaimed",
  canonicalValidationId: null,
  candidateSha256: null,
  assetSetSha256: null,
  resourceCount: null,
  archivedResourceCount: 0,
  createdAt: "2026-10-12T00:00:00.000Z",
  updatedAt: "2026-10-12T00:00:00.000Z",
  validatedAt: null,
  readyAt: null,
  platformApproval: "unverified",
  publishable: false,
};
export function memoryStorage(): PendingStorage & { value: string | null } {
  return {
    value: null,
    getItem() {
      return this.value;
    },
    setItem(_key, value) {
      this.value = value;
    },
  };
}
