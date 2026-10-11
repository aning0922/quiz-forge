import { z } from "zod";
import { MAX_ARCHIVE_BYTES, MAX_REVISION } from "./limits";
export type { Page } from "@/features/product/workspace/contracts";
export const importIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const idempotencyKeySchema = importIdSchema;
export const archiveHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const importStatusSchema = z.enum([
  "awaiting-upload",
  "receiving",
  "received",
  "retryable-failed",
  "rejected",
]);
export const storageConditionSchema = z.enum([
  "clean",
  "cleanup-required",
  "unknown",
]);
export const receiveErrorCodeSchema = z.enum([
  "RECEIVE_TIMEOUT",
  "RECEIVE_LENGTH_MISMATCH",
  "RECEIVE_HASH_MISMATCH",
  "RECEIVE_LOCK_LOST",
  "RECEIVE_RECOVERY_REQUIRED",
  "RECEIVE_STORAGE_CONFLICT",
  "RECEIVE_SCAN_LIMIT",
  "WRITE_OUTCOME_UNKNOWN",
  "STUDIO_UNAVAILABLE",
]);
export const createImportIntentSchema = z.strictObject({
  expectedArchiveSha256: archiveHashSchema,
  expectedArchiveBytes: z.number().int().min(1).max(MAX_ARCHIVE_BYTES),
  target: z.strictObject({ kind: z.literal("new-draft") }),
});
export const recoverReceiveSchema = z.strictObject({
  expectedStateRevision: z.number().int().min(1).max(MAX_REVISION),
});
export const importListQuerySchema = z.strictObject({
  page: z.number().int().min(1).max(1000).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
  status: importStatusSchema.optional(),
  idempotencyKey: idempotencyKeySchema.optional(),
});
export type CreateImportIntent = z.infer<typeof createImportIntentSchema>;
export type RecoverReceive = z.infer<typeof recoverReceiveSchema>;
export type ImportListQuery = z.infer<typeof importListQuerySchema>;
export type ImportStatus = z.infer<typeof importStatusSchema>;
export type StorageCondition = z.infer<typeof storageConditionSchema>;
export type ReceiveErrorCode = z.infer<typeof receiveErrorCodeSchema>;
export type ImportSettingsDto = {
  enabled: boolean;
  maxArchiveBytes: 33554432;
  receiveTimeoutMs: 60000;
};
export type ImportDto = {
  id: string;
  productId: string;
  status: ImportStatus;
  stateRevision: number;
  expectedArchiveSha256: string;
  expectedArchiveBytes: number;
  actualArchiveSha256: string | null;
  actualArchiveBytes: number | null;
  createdAt: string;
  updatedAt: string;
  receivedAt: string | null;
  storageCondition: StorageCondition;
  lastErrorCode: ReceiveErrorCode | null;
  validationStatus: "not-run";
  publishable: false;
};
