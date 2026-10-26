import { captureStudioEpoch, acceptsStudioEpoch } from "../authority-events";
import { z } from "zod";
import {
  archiveHashSchema,
  createImportIntentSchema,
  importIdSchema,
  importStatusSchema,
  recoverReceiveSchema,
  receiveErrorCodeSchema,
  storageConditionSchema,
  type CreateImportIntent,
  type ImportDto,
  type ImportSettingsDto,
  type Page,
} from "@/features/quizpack/import/contracts";
import { productIdSchema } from "@/features/product/workspace/contracts";
import {
  MAX_ARCHIVE_BYTES,
  RECEIVE_TIMEOUT_MS,
} from "@/features/quizpack/import/limits";
import { StudioClientError } from "../client";

const instant = z.iso.datetime();
const importDtoSchema = z
  .strictObject({
    id: importIdSchema,
    productId: productIdSchema,
    status: importStatusSchema,
    stateRevision: recoverReceiveSchema.shape.expectedStateRevision,
    expectedArchiveSha256: archiveHashSchema,
    expectedArchiveBytes: createImportIntentSchema.shape.expectedArchiveBytes,
    actualArchiveSha256: archiveHashSchema.nullable(),
    actualArchiveBytes:
      createImportIntentSchema.shape.expectedArchiveBytes.nullable(),
    createdAt: instant,
    updatedAt: instant,
    receivedAt: instant.nullable(),
    storageCondition: storageConditionSchema,
    lastErrorCode: receiveErrorCodeSchema.nullable(),
    validationStatus: z.literal("not-run"),
    publishable: z.literal(false),
  })
  .refine((value) =>
    value.status === "received"
      ? value.actualArchiveBytes === value.expectedArchiveBytes &&
        value.actualArchiveSha256 === value.expectedArchiveSha256 &&
        value.receivedAt !== null
      : value.actualArchiveBytes === null &&
        value.actualArchiveSha256 === null &&
        value.receivedAt === null,
  );
const settingsDtoSchema = z.strictObject({
  enabled: z.boolean(),
  maxArchiveBytes: z.literal(MAX_ARCHIVE_BYTES),
  receiveTimeoutMs: z.literal(RECEIVE_TIMEOUT_MS),
});
const importPageSchema = z
  .strictObject({
    items: z.array(importDtoSchema).max(50),
    page: z.number().int().min(1).max(1000),
    pageSize: z.number().int().min(1).max(50),
    total: z.number().int().min(0),
    hasNext: z.boolean(),
  })
  .refine(
    (value) =>
      value.items.length <= value.pageSize && value.items.length <= value.total,
  );

type ImportExpectation = {
  productId: string;
  importId?: string;
  input?: CreateImportIntent;
};
function matches(value: ImportDto, expected: ImportExpectation): boolean {
  return (
    value.productId === expected.productId &&
    (!expected.importId || value.id === expected.importId) &&
    (!expected.input ||
      (value.expectedArchiveSha256 === expected.input.expectedArchiveSha256 &&
        value.expectedArchiveBytes === expected.input.expectedArchiveBytes))
  );
}
export function checkImport(
  value: unknown,
  expected: ImportExpectation,
): ImportDto {
  const parsed = importDtoSchema.parse(value);
  if (!matches(parsed, expected)) throw new Error("INVALID_IMPORT_RESPONSE");
  return parsed;
}
export function checkSettings(value: unknown): ImportSettingsDto {
  return settingsDtoSchema.parse(value);
}
export function checkImportPage(
  value: unknown,
  expected: ImportExpectation & {
    page: number;
    pageSize: number;
    exact?: boolean;
  },
): Page<ImportDto> {
  const parsed = importPageSchema.parse(value);
  if (
    parsed.page !== expected.page ||
    parsed.pageSize !== expected.pageSize ||
    !parsed.items.every((item) => matches(item, expected))
  )
    throw new Error("INVALID_IMPORT_PAGE");
  if (
    expected.exact &&
    (parsed.items.length > 1 ||
      parsed.total !== parsed.items.length ||
      parsed.hasNext)
  )
    throw new Error("INVALID_EXACT_IMPORT_PAGE");
  return parsed;
}
// Only documented rejections may unblock an explicit new request. Unknown strings
// and malformed success/error envelopes remain uncertain for every write.
const knownErrorStatuses: Record<string, number> = {
  INVALID_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  UNAUTHENTICATED: 401,
  ORIGIN_REJECTED: 403,
  CSRF_REJECTED: 403,
  CAPABILITY_DENIED: 403,
  PRODUCT_NOT_FOUND: 404,
  PRODUCT_ARCHIVED: 409,
  IMPORT_NOT_FOUND: 404,
  IMPORTS_DISABLED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  IMPORT_STATE_CONFLICT: 409,
  IMPORT_INTENT_LIMIT: 409,
  RECEIVE_BUSY: 409,
  RECEIVE_QUOTA_EXCEEDED: 409,
  RECEIVE_ATTEMPT_LIMIT: 409,
  RECEIVE_RECOVERY_REQUIRED: 409,
  RECEIVE_STORAGE_CONFLICT: 409,
  RECEIVE_SCAN_LIMIT: 409,
  RECEIVE_TIMEOUT: 408,
  RECEIVE_LENGTH_MISMATCH: 422,
  RECEIVE_HASH_MISMATCH: 422,
  RECEIVE_LOCK_LOST: 503,
  REVISION_LIMIT: 409,
  WRITE_BUSY: 409,
  WRITE_OUTCOME_UNKNOWN: 503,
  STUDIO_UNAVAILABLE: 503,
};
const errorEnvelopeSchema = z.strictObject({
  code: z.string(),
  requestId: importIdSchema,
  currentRevision: recoverReceiveSchema.shape.expectedStateRevision.optional(),
  importId: importIdSchema.optional(),
});
export async function checkedImportFetch<T>(
  path: string,
  options: RequestInit,
  check: (value: unknown) => T,
  write = false,
  successStatuses: readonly number[] = [200],
): Promise<T> {
  const uncertainCode = write ? "WRITE_OUTCOME_UNKNOWN" : "STUDIO_UNAVAILABLE";
  const requestEpoch = captureStudioEpoch();
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new StudioClientError(uncertainCode);
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new StudioClientError(uncertainCode);
  }
  if (!acceptsStudioEpoch(requestEpoch))
    throw new StudioClientError("STUDIO_REQUEST_STALE");
  if (!response.ok) {
    const envelope = errorEnvelopeSchema.safeParse(value);
    if (
      !envelope.success ||
      !Object.hasOwn(knownErrorStatuses, envelope.data.code) ||
      knownErrorStatuses[envelope.data.code] !== response.status ||
      (envelope.data.currentRevision !== undefined &&
        envelope.data.code !== "IMPORT_STATE_CONFLICT")
    )
      throw new StudioClientError(uncertainCode);
    throw new StudioClientError(
      envelope.data.code,
      envelope.data.currentRevision,
    );
  }
  if (!successStatuses.includes(response.status))
    throw new StudioClientError(uncertainCode);
  try {
    if (!acceptsStudioEpoch(requestEpoch))
      throw new StudioClientError("STUDIO_REQUEST_STALE");
    return check(value);
  } catch {
    throw new StudioClientError(uncertainCode);
  }
}
