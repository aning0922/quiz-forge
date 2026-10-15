import { z } from "zod";
import {
  preparedValidationDtoSchema,
  startValidationResultSchema,
  validationDtoSchema,
  validationPageSchema,
  revisionSchema,
  validationIdSchema,
  type PreparedValidationDto,
  type ValidationDto,
  type StartValidationResult,
  type Page,
} from "@/features/quizpack/validation/contracts";
import { StudioClientError } from "../client";
import type { PendingTuple } from "./pending";
export type RoutePair = { productId: string; importId: string };
export function validationEndpoint(pair: RoutePair): string {
  return `/api/studio/products/${encodeURIComponent(pair.productId)}/imports/${encodeURIComponent(pair.importId)}/validations`;
}
export function matchesValidation(
  value: ValidationDto,
  tuple: PendingTuple,
): boolean {
  return (
    value.productId === tuple.productId &&
    value.importId === tuple.importId &&
    value.validationKey === tuple.expectedValidationKey &&
    value.archiveSha256 === tuple.archiveSha256 &&
    value.archiveBytes === tuple.archiveBytes &&
    value.identitySha256 === tuple.identitySha256
  );
}
export function checkPrepared(
  value: unknown,
  expected: Omit<PendingTuple, "identitySha256" | "expectedValidationKey">,
): PreparedValidationDto {
  const dto = preparedValidationDtoSchema.parse(value);
  if (
    dto.productId !== expected.productId ||
    dto.importId !== expected.importId ||
    dto.expectedImportStateRevision !== expected.expectedImportStateRevision ||
    dto.archiveSha256 !== expected.archiveSha256 ||
    dto.archiveBytes !== expected.archiveBytes
  )
    throw new Error("INVALID_PREPARED_RESPONSE");
  return dto;
}
export function checkValidation(
  value: unknown,
  expected: RoutePair & { validationId?: string; tuple?: PendingTuple },
): ValidationDto {
  const dto = validationDtoSchema.parse(value);
  if (
    dto.productId !== expected.productId ||
    dto.importId !== expected.importId ||
    (expected.validationId && dto.id !== expected.validationId) ||
    (expected.tuple && !matchesValidation(dto, expected.tuple))
  )
    throw new Error("INVALID_VALIDATION_RESPONSE");
  return dto;
}
export function checkValidationPage(
  value: unknown,
  expected: RoutePair & {
    page: number;
    pageSize: number;
    tuple?: PendingTuple;
  },
): Page<ValidationDto> {
  const page = validationPageSchema.parse(value);
  if (
    page.page !== expected.page ||
    page.pageSize !== expected.pageSize ||
    page.items.length > page.pageSize ||
    page.items.length > page.total ||
    !page.items.every(
      (item) =>
        item.productId === expected.productId &&
        item.importId === expected.importId,
    )
  )
    throw new Error("INVALID_VALIDATION_PAGE");
  if (
    expected.tuple &&
    (page.page !== 1 ||
      page.pageSize !== 1 ||
      page.total !== page.items.length ||
      page.hasNext ||
      page.items.length > 1 ||
      !page.items.every((item) => matchesValidation(item, expected.tuple!)))
  )
    throw new Error("INVALID_EXACT_VALIDATION_PAGE");
  return page;
}
export function checkStart(
  value: unknown,
  status: number,
  tuple: PendingTuple,
): StartValidationResult {
  const result = startValidationResultSchema.parse(value);
  if (result.outcome === "record") {
    if (
      status !== (result.created ? 201 : 200) ||
      !matchesValidation(result.validation, tuple)
    )
      throw new Error("INVALID_START_RESPONSE");
  } else if (
    status !== 200 ||
    result.productId !== tuple.productId ||
    result.importId !== tuple.importId ||
    result.expectedValidationKey !== tuple.expectedValidationKey ||
    result.expectedImportStateRevision !== tuple.expectedImportStateRevision
  )
    throw new Error("INVALID_NOT_STARTED_RESPONSE");
  return result;
}
const errorSchema = z.strictObject({
  code: z.string(),
  requestId: validationIdSchema,
  currentRevision: revisionSchema.optional(),
});
const errors: Record<string, number> = {
  INVALID_REQUEST: 400,
  UNAUTHENTICATED: 401,
  CSRF_REJECTED: 403,
  ORIGIN_REJECTED: 403,
  CAPABILITY_DENIED: 403,
  PRODUCT_NOT_FOUND: 404,
  IMPORT_NOT_FOUND: 404,
  VALIDATION_NOT_FOUND: 404,
  VALIDATION_CANCELLED: 408,
  VALIDATION_STATE_CONFLICT: 409,
  VALIDATION_BUSY: 409,
  VALIDATION_IDENTITY_CHANGED: 409,
  VALIDATION_REVALIDATION_REQUIRED: 409,
  VALIDATION_ATTEMPT_LIMIT: 409,
  VALIDATION_PENDING_LIMIT: 409,
  PRODUCT_ARCHIVED: 409,
  IMPORTS_DISABLED: 409,
  IMPORT_STATE_CONFLICT: 409,
  REVISION_LIMIT: 409,
  VALIDATION_STORAGE_CONFLICT: 503,
  VALIDATION_SCAN_LIMIT: 503,
  VALIDATION_QUOTA_EXCEEDED: 503,
  VALIDATION_RECOVERY_REQUIRED: 503,
  VALIDATION_LOCK_LOST: 503,
  MEDIA_UNAVAILABLE: 503,
  EVIDENCE_INVALID: 503,
  WRITE_OUTCOME_UNKNOWN: 503,
  STUDIO_UNAVAILABLE: 503,
  VALIDATION_TIMEOUT: 504,
};
/** Errors carry a finite explanation only; no non-2xx can authorize pending removal. */
export async function checkedValidationFetch<T>(
  path: string,
  options: RequestInit,
  check: (value: unknown, status: number) => T,
  write = false,
  statuses: readonly number[] = [200],
): Promise<T> {
  const uncertain = write ? "WRITE_OUTCOME_UNKNOWN" : "STUDIO_UNAVAILABLE";
  let response: Response;
  let value: unknown;
  try {
    response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    value = await response.json();
  } catch {
    throw new StudioClientError(uncertain);
  }
  if (!response.ok) {
    const parsed = errorSchema.safeParse(value);
    if (
      !parsed.success ||
      errors[parsed.data.code] !== response.status ||
      (parsed.data.currentRevision !== undefined &&
        parsed.data.code !== "VALIDATION_STATE_CONFLICT" &&
        parsed.data.code !== "IMPORT_STATE_CONFLICT")
    )
      throw new StudioClientError(uncertain);
    throw new StudioClientError(parsed.data.code, parsed.data.currentRevision);
  }
  if (!statuses.includes(response.status))
    throw new StudioClientError(uncertain);
  try {
    return check(value, response.status);
  } catch {
    throw new StudioClientError(uncertain);
  }
}
