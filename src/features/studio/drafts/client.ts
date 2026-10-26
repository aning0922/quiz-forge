import { captureStudioEpoch, acceptsStudioEpoch } from "../authority-events";
import { z } from "zod";
import {
  DRAFT_LIMITS,
  applyDraftResultSchema,
  draftApplicationDtoSchema,
  draftApplicationFingerprint,
  draftApplicationReadResultSchema,
  draftReadResultSchema,
  draftRevisionDtoSchema,
  validationStateRevisionSchema,
  type DraftApplicationBinding,
  type DraftApplicationDto,
} from "@/features/product/drafts/contracts";
import { StudioClientError } from "../client";
import { readBoundedDraftJson } from "./response";
export const draftEndpoint = (productId: string) =>
  `/api/studio/products/${encodeURIComponent(productId)}/draft`;
export const draftApplicationEndpoint = (productId: string, key: string) =>
  `/api/studio/products/${encodeURIComponent(productId)}/draft-applications/${encodeURIComponent(key)}`;
export const applyDraftEndpoint = (tuple: DraftApplicationBinding) =>
  `/api/studio/products/${encodeURIComponent(tuple.productId)}/imports/${encodeURIComponent(tuple.sourceImportId)}/validations/${encodeURIComponent(tuple.sourceValidationId)}/apply`;
export const draftRevisionEndpoint = (
  productId: string,
  draftId: string,
  revision: number,
) =>
  `/api/studio/products/${encodeURIComponent(productId)}/drafts/${encodeURIComponent(draftId)}/revisions/${revision}`;
export const draftWorkspacePath = (productId: string) =>
  `/studio/products/${encodeURIComponent(productId)}?task=content&panel=revisions`;
export const draftRevisionPath = (
  productId: string,
  draftId: string,
  revision: number,
) =>
  `/studio/products/${encodeURIComponent(productId)}/drafts/${encodeURIComponent(draftId)}/revisions/${revision}`;
function matches(
  application: DraftApplicationDto,
  tuple: DraftApplicationBinding,
): boolean {
  return (
    application.productId === tuple.productId &&
    application.sourceImportId === tuple.sourceImportId &&
    application.sourceValidationId === tuple.sourceValidationId &&
    application.idempotencyKey === tuple.idempotencyKey &&
    application.expectedValidationStateRevision ===
      tuple.expectedValidationStateRevision &&
    application.expectedCandidateSha256 === tuple.expectedCandidateSha256 &&
    application.target.kind === tuple.target.kind
  );
}
async function checkReceipt(value: unknown, tuple: DraftApplicationBinding) {
  const application = draftApplicationDtoSchema.parse(value);
  const fingerprint = await draftApplicationFingerprint({
    productId: tuple.productId,
    sourceImportId: tuple.sourceImportId,
    sourceValidationId: tuple.sourceValidationId,
    expectedValidationStateRevision: tuple.expectedValidationStateRevision,
    expectedCandidateSha256: tuple.expectedCandidateSha256,
    target: tuple.target,
  });
  if (!matches(application, tuple) || application.fingerprint !== fingerprint)
    throw new Error("INVALID_DRAFT_RECEIPT");
  return application;
}
export async function checkApplyDraft(
  value: unknown,
  status: number,
  tuple: DraftApplicationBinding,
) {
  const result = applyDraftResultSchema.parse(value);
  if (status !== (result.created ? 201 : 200))
    throw new Error("INVALID_APPLY_STATUS");
  await checkReceipt(result.application, tuple);
  return result;
}
export async function checkDraftApplication(
  value: unknown,
  tuple: DraftApplicationBinding,
) {
  const result = draftApplicationReadResultSchema.parse(value);
  if (result.kind === "empty") {
    if (
      result.productId !== tuple.productId ||
      result.idempotencyKey !== tuple.idempotencyKey
    )
      throw new Error("INVALID_APPLICATION_SCOPE");
  } else await checkReceipt(result.application, tuple);
  return result;
}
export function checkDraftRead(value: unknown, productId: string) {
  const result = draftReadResultSchema.parse(value);
  if (
    (result.kind === "empty" ? result.productId : result.draft.productId) !==
    productId
  )
    throw new Error("INVALID_DRAFT_SCOPE");
  return result;
}
async function hash(text: string) {
  const bytes = new TextEncoder().encode(text),
    digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export async function checkDraftRevision(
  value: unknown,
  expected: { productId: string; draftId: string; revision: number },
) {
  const result = draftRevisionDtoSchema.parse(value);
  if (
    result.draft.productId !== expected.productId ||
    result.draft.draftId !== expected.draftId ||
    result.draft.revision !== expected.revision ||
    (await hash(result.canonicalContentText)) !==
      result.draft.canonicalContentSha256 ||
    (await hash(result.assetSetText)) !== result.draft.assetSetSha256
  )
    throw new Error("INVALID_REVISION_CONTENT");
  return result;
}
const errorSchema = z.strictObject({
  code: z.string(),
  requestId: z.uuid(),
  currentRevision: validationStateRevisionSchema.optional(),
});
const errors: Record<string, number> = {
  INVALID_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  UNAUTHENTICATED: 401,
  CSRF_REJECTED: 403,
  ORIGIN_REJECTED: 403,
  CAPABILITY_DENIED: 403,
  PRODUCT_NOT_FOUND: 404,
  IMPORT_NOT_FOUND: 404,
  VALIDATION_NOT_FOUND: 404,
  DRAFT_NOT_FOUND: 404,
  DRAFT_REVISION_NOT_FOUND: 404,
  DRAFT_ALREADY_EXISTS: 409,
  DRAFT_SOURCE_INVALID: 409,
  DRAFT_SOURCE_CHANGED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  PRODUCT_ARCHIVED: 409,
  WRITE_BUSY: 409,
  WRITE_OUTCOME_UNKNOWN: 503,
  STUDIO_UNAVAILABLE: 503,
};
export async function checkedDraftFetch<T>(
  path: string,
  options: RequestInit,
  check: (value: unknown, status: number) => T | Promise<T>,
  config: { write?: boolean; revision?: boolean } = {},
): Promise<T> {
  const uncertain = config.write
    ? "WRITE_OUTCOME_UNKNOWN"
    : "STUDIO_UNAVAILABLE";
  const controller = new AbortController();
  const deadlineMonotonicMs = performance.now() + 15_000;
  const abort = () => controller.abort();
  const externalSignal = options.signal;
  externalSignal?.addEventListener("abort", abort, { once: true });
  if (externalSignal?.aborted) abort();
  const timer = setTimeout(abort, 15_000);
  const requestEpoch = captureStudioEpoch();
  const checkpoint = () => {
    if (!acceptsStudioEpoch(requestEpoch))
      throw new StudioClientError("STUDIO_REQUEST_STALE");
    if (controller.signal.aborted || performance.now() >= deadlineMonotonicMs)
      throw new StudioClientError(uncertain);
  };
  try {
    checkpoint();
    const response = await fetch(path, {
      ...options,
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    const value = await readBoundedDraftJson(
      response,
      config.revision && response.ok
        ? DRAFT_LIMITS.revisionResponseBytes
        : DRAFT_LIMITS.smallResponseBytes,
      { signal: controller.signal, deadlineMonotonicMs },
    );
    checkpoint();
    if (!response.ok) {
      const parsed = errorSchema.safeParse(value);
      if (
        !parsed.success ||
        errors[parsed.data.code] !== response.status ||
        (parsed.data.currentRevision !== undefined &&
          parsed.data.code !== "DRAFT_SOURCE_CHANGED")
      )
        throw new StudioClientError(uncertain);
      throw new StudioClientError(
        parsed.data.code,
        parsed.data.currentRevision,
      );
    }
    if (!(config.write ? [200, 201] : [200]).includes(response.status))
      throw new StudioClientError(uncertain);
    try {
      const result = await check(value, response.status);
      checkpoint();
      return result;
    } catch {
      throw new StudioClientError(uncertain);
    }
  } catch (error) {
    if (error instanceof StudioClientError) throw error;
    throw new StudioClientError(uncertain);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abort);
    controller.abort();
  }
}
