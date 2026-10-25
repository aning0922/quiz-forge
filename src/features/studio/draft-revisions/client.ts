import { captureStudioEpoch, acceptsStudioEpoch } from "../authority-events";
import { z } from "zod";
import {
  DRAFT_REVISION_LIMITS,
  appendDraftBindingSchema,
  appendReadyValidationSchema,
  appendDraftResultSchema,
  appendDraftApplicationSchema,
  appendBindingFromApplication,
  appendDraftFingerprint,
  fingerprintInputFromAppendBinding,
  sameAppendDraftBinding,
  draftRevisionResolutionSchema,
  draftRevisionHistorySchema,
  draftRevisionHistoryQuerySchema,
  type AppendDraftBinding,
  type DraftRevisionHistoryQuery,
} from "@/features/product/draft-revisions/contracts";
import { validationStateRevisionSchema } from "@/features/product/drafts/contracts";
import { StudioClientError } from "../client";
import { readBoundedDraftJson } from "../drafts/response";
import {
  appendRevisionEndpoint,
  resolveRevisionEndpoint,
  revisionHistoryEndpoint,
} from "./urls";

const statuses: Readonly<Record<string, number>> = Object.freeze({
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
  DRAFT_SOURCE_INVALID: 409,
  DRAFT_SOURCE_CHANGED: 409,
  DRAFT_BASE_CONFLICT: 409,
  DRAFT_SOURCE_ALREADY_APPLIED: 409,
  DRAFT_REVISION_LIMIT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  PRODUCT_ARCHIVED: 409,
  WRITE_BUSY: 409,
  WRITE_OUTCOME_UNKNOWN: 503,
  STUDIO_UNAVAILABLE: 503,
});
const errorSchema = z.strictObject({
  code: z.string(),
  requestId: z.uuid(),
  currentRevision: validationStateRevisionSchema.optional(),
});
export function validRevisionHttpError(
  error: unknown,
  status: number,
  write: boolean,
) {
  const result = errorSchema.safeParse(error);
  return result.success &&
    statuses[result.data.code] === status &&
    (result.data.currentRevision === undefined ||
      result.data.code === "DRAFT_SOURCE_CHANGED") &&
    (write || result.data.code !== "WRITE_OUTCOME_UNKNOWN")
    ? result.data
    : undefined;
}
export async function checkedRevisionFetch<T>(
  path: string,
  options: RequestInit,
  check: (value: unknown, status: number) => T | Promise<T>,
  operation: "append" | "resolve" | "history",
): Promise<T> {
  const write = operation === "append",
    fallback = write ? "WRITE_OUTCOME_UNKNOWN" : "STUDIO_UNAVAILABLE",
    controller = new AbortController(),
    deadline = performance.now() + 15000;
  const abort = () => controller.abort(),
    external = options.signal;
  external?.addEventListener("abort", abort, { once: true });
  if (external?.aborted) abort();
  const requestEpoch = captureStudioEpoch();
  const timer = setTimeout(abort, 15000),
    checkpoint = () => {
      if (!acceptsStudioEpoch(requestEpoch))
        throw new StudioClientError("STUDIO_REQUEST_STALE");
      if (controller.signal.aborted || performance.now() >= deadline)
        throw new StudioClientError(fallback);
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
      response.ok
        ? operation === "history"
          ? DRAFT_REVISION_LIMITS.historyResponseBytes
          : DRAFT_REVISION_LIMITS.responseBytes
        : DRAFT_REVISION_LIMITS.errorResponseBytes,
      { signal: controller.signal, deadlineMonotonicMs: deadline },
    );
    checkpoint();
    if (!response.ok) {
      const error = validRevisionHttpError(value, response.status, write);
      if (!error) throw new StudioClientError(fallback);
      throw new StudioClientError(error.code, error.currentRevision);
    }
    if (!(write ? [200, 201] : [200]).includes(response.status))
      throw new StudioClientError(fallback);
    const result = await check(value, response.status);
    checkpoint();
    return result;
  } catch (error) {
    if (error instanceof StudioClientError) throw error;
    throw new StudioClientError(fallback);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", abort);
    controller.abort();
  }
}
export async function checkAppendApplication(
  value: unknown,
  expected: AppendDraftBinding,
) {
  const application = appendDraftApplicationSchema.parse(value);
  if (
    !sameAppendDraftBinding(
      appendBindingFromApplication(application),
      expected,
    ) ||
    application.fingerprint !==
      (await appendDraftFingerprint(
        fingerprintInputFromAppendBinding(expected),
      ))
  )
    throw Error("INVALID_APPEND_RECEIPT");
  return application;
}
export async function checkAppendResult(
  value: unknown,
  status: number,
  expected: AppendDraftBinding,
) {
  const result = appendDraftResultSchema.parse(value);
  if (status !== (result.created ? 201 : 200))
    throw Error("INVALID_APPEND_STATUS");
  await checkAppendApplication(result.application, expected);
  return result;
}
export async function checkRevisionResolution(
  value: unknown,
  expected: AppendDraftBinding,
) {
  const result = draftRevisionResolutionSchema.parse(value);
  if (
    !sameAppendDraftBinding(result.binding, expected) ||
    result.fingerprint !==
      (await appendDraftFingerprint(
        fingerprintInputFromAppendBinding(expected),
      ))
  )
    throw Error("INVALID_REVISION_RESOLUTION");
  if (result.kind === "applied")
    await checkAppendApplication(result.application, expected);
  return result;
}
export function checkRevisionHistory(
  value: unknown,
  productId: string,
  draftId: string,
  input: DraftRevisionHistoryQuery,
) {
  const result = draftRevisionHistorySchema.parse(value),
    query = draftRevisionHistoryQuerySchema.parse(input);
  if (
    result.productId !== productId ||
    result.draftId !== draftId ||
    result.pageSize !== query.pageSize ||
    (query.anchorRevision !== undefined &&
      result.anchorRevision !== query.anchorRevision) ||
    result.beforeRevision !==
      (query.beforeRevision ?? result.anchorRevision + 1)
  )
    throw Error("INVALID_REVISION_HISTORY");
  return result;
}
function body(value: unknown) {
  const text = JSON.stringify(value);
  if (
    new TextEncoder().encode(text).byteLength >
    DRAFT_REVISION_LIMITS.requestBytes
  )
    throw Error("REVISION_REQUEST_LIMIT");
  return text;
}
/** All validation/serialization is done before the durable sent gate; invoke immediately after that gate. */
export function prepareAppendRequest(input: AppendDraftBinding, csrf: string) {
  const binding = appendDraftBindingSchema.parse(input),
    path = appendRevisionEndpoint(binding),
    payload = body(
      appendReadyValidationSchema.parse({
        idempotencyKey: binding.idempotencyKey,
        expectedValidationStateRevision:
          binding.expectedValidationStateRevision,
        expectedCandidateSha256: binding.expectedCandidateSha256,
        target: binding.target,
      }),
    );
  return () =>
    checkedRevisionFetch(
      path,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: payload,
      },
      (v, status) => checkAppendResult(v, status, binding),
      "append",
    );
}
export function resolveRevision(
  input: AppendDraftBinding,
  csrf: string,
  signal?: AbortSignal,
) {
  const binding = appendDraftBindingSchema.parse(input);
  return checkedRevisionFetch(
    resolveRevisionEndpoint(binding.productId),
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: body(binding),
      ...(signal ? { signal } : {}),
    },
    (v) => checkRevisionResolution(v, binding),
    "resolve",
  );
}
export function readRevisionHistory(
  productId: string,
  draftId: string,
  query: DraftRevisionHistoryQuery,
  signal: AbortSignal,
) {
  return checkedRevisionFetch(
    revisionHistoryEndpoint(productId, draftId, query),
    { signal },
    (v) => checkRevisionHistory(v, productId, draftId, query),
    "history",
  );
}
