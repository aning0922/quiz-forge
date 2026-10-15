import { z } from "zod";
import { packIdSchema, packVersionSchema, sha256Schema } from "../v1/manifest";
import { importIdSchema, storageConditionSchema } from "../import/contracts";
import {
  MAX_ARCHIVE_BYTES,
  MAX_ATTEMPTS,
  MAX_RESOURCES,
  MAX_REVISION,
} from "./limits";
export type { Page } from "@/features/product/workspace/contracts";
export const validationIdSchema = importIdSchema;
export const validationKeySchema = sha256Schema;
export const validationStatusSchema = z.enum([
  "validating",
  "validated",
  "archiving",
  "ready",
  "rejected",
  "retryable-failed",
]);
export const validationErrorCodeSchema = z.enum([
  "VALIDATION_TIMEOUT",
  "VALIDATION_CANCELLED",
  "VALIDATION_LOCK_LOST",
  "VALIDATION_RECOVERY_REQUIRED",
  "VALIDATION_STORAGE_CONFLICT",
  "VALIDATION_SCAN_LIMIT",
  "VALIDATION_QUOTA_EXCEEDED",
  "VALIDATION_STATE_CONFLICT",
  "VALIDATION_IDENTITY_CHANGED",
  "VALIDATION_REVALIDATION_REQUIRED",
  "VALIDATION_ATTEMPT_LIMIT",
  "VALIDATION_REJECTED",
  "PACK_IDENTITY_CONFLICT",
  "RESOURCE_DECLARATION_CONFLICT",
  "MEDIA_UNAVAILABLE",
  "EVIDENCE_INVALID",
  "WRITE_OUTCOME_UNKNOWN",
  "STUDIO_UNAVAILABLE",
]);
export const preclaimStartCodeSchema = z.enum([
  "VALIDATION_IDENTITY_CHANGED",
  "IMPORT_STATE_CONFLICT",
  "PRODUCT_ARCHIVED",
  "IMPORTS_DISABLED",
  "VALIDATION_PENDING_LIMIT",
  "VALIDATION_QUOTA_EXCEEDED",
  "VALIDATION_SCAN_LIMIT",
  "VALIDATION_BUSY",
  "VALIDATION_STORAGE_CONFLICT",
  "MEDIA_UNAVAILABLE",
]);
export const identityKindSchema = z.enum([
  "unclaimed",
  "canonical",
  "alias",
  "conflict",
]);
export const revisionSchema = z.number().int().min(1).max(MAX_REVISION);
const boundedAscii = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[\x21-\x7e]+$/);
const isoSchema = z.iso.datetime({ precision: 3 });
export const prepareValidationSchema = z.strictObject({
  expectedImportStateRevision: revisionSchema,
});
export const startValidationSchema = z.strictObject({
  expectedImportStateRevision: revisionSchema,
  expectedValidationKey: validationKeySchema,
});
export const validationCasSchema = z.strictObject({
  expectedStateRevision: revisionSchema,
});
export const validationListQuerySchema = z.strictObject({
  page: z.number().int().min(1).max(1000).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
  status: validationStatusSchema.optional(),
  validationKey: validationKeySchema.optional(),
});
export const preparedValidationDtoSchema = z.strictObject({
  productId: packIdSchema,
  importId: importIdSchema,
  expectedImportStateRevision: revisionSchema,
  archiveSha256: sha256Schema,
  archiveBytes: z.number().int().min(1).max(MAX_ARCHIVE_BYTES),
  identitySha256: sha256Schema,
  validationKey: validationKeySchema,
});
export const validationDtoSchema = z
  .strictObject({
    id: validationIdSchema,
    productId: packIdSchema,
    importId: importIdSchema,
    validationKey: validationKeySchema,
    stateRevision: revisionSchema,
    status: validationStatusSchema,
    readOnly: z.boolean(),
    storageCondition: storageConditionSchema,
    lastErrorCode: validationErrorCodeSchema.nullable(),
    attemptCount: z.number().int().min(1).max(MAX_ATTEMPTS),
    remainingAttempts: z
      .number()
      .int()
      .min(0)
      .max(MAX_ATTEMPTS - 1),
    maintenanceRequired: z.boolean(),
    archiveSha256: sha256Schema,
    archiveBytes: z.number().int().min(1).max(MAX_ARCHIVE_BYTES),
    identitySha256: sha256Schema,
    validatorBundleSha256: sha256Schema,
    packId: packIdSchema.nullable(),
    packVersion: packVersionSchema.nullable(),
    containerSchemaVersion: boundedAscii.nullable(),
    contentSchemaVersion: boundedAscii.nullable(),
    identityKind: identityKindSchema,
    canonicalValidationId: validationIdSchema.nullable(),
    candidateSha256: sha256Schema.nullable(),
    assetSetSha256: sha256Schema.nullable(),
    resourceCount: z.number().int().min(1).max(MAX_RESOURCES).nullable(),
    archivedResourceCount: z.number().int().min(0).max(MAX_RESOURCES),
    createdAt: isoSchema,
    updatedAt: isoSchema,
    validatedAt: isoSchema.nullable(),
    readyAt: isoSchema.nullable(),
    platformApproval: z.literal("unverified"),
    publishable: z.literal(false),
  })
  .superRefine((v, ctx) => {
    if (
      v.remainingAttempts !== MAX_ATTEMPTS - v.attemptCount ||
      (v.status === "ready" &&
        (v.resourceCount === null ||
          v.archivedResourceCount !== v.resourceCount))
    )
      ctx.addIssue({
        code: "custom",
        message: "Inconsistent validation summary.",
      });
  });
export const startValidationResultSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("record"),
    created: z.boolean(),
    validation: validationDtoSchema,
  }),
  z.strictObject({
    outcome: z.literal("not-started"),
    execution: z.literal("not-started"),
    productId: packIdSchema,
    importId: importIdSchema,
    expectedValidationKey: validationKeySchema,
    expectedImportStateRevision: revisionSchema,
    code: preclaimStartCodeSchema,
  }),
]);
export const validationPageSchema = z.strictObject({
  items: z.array(validationDtoSchema).max(50),
  page: z.number().int().min(1).max(1000),
  pageSize: z.number().int().min(1).max(50),
  total: z.number().int().nonnegative(),
  hasNext: z.boolean(),
});
export type ValidationStatus = z.infer<typeof validationStatusSchema>;
export type ValidationErrorCode = z.infer<typeof validationErrorCodeSchema>;
export type PreclaimStartCode = z.infer<typeof preclaimStartCodeSchema>;
export type IdentityKind = z.infer<typeof identityKindSchema>;
export type PrepareValidation = z.infer<typeof prepareValidationSchema>;
export type StartValidation = z.infer<typeof startValidationSchema>;
export type ValidationCas = z.infer<typeof validationCasSchema>;
export type ValidationListQuery = z.infer<typeof validationListQuerySchema>;
export type PreparedValidationDto = z.infer<typeof preparedValidationDtoSchema>;
export type ValidationDto = z.infer<typeof validationDtoSchema>;
export type StartValidationResult = z.infer<typeof startValidationResultSchema>;
