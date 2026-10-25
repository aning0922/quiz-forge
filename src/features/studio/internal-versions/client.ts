import { captureStudioEpoch, acceptsStudioEpoch } from "../authority-events";
import {
  INTERNAL_VERSION_LIMITS as L,
  INTERNAL_VERSION_HTTP_STATUSES,
  internalVersionHttpErrorSchema,
  recordBaselineInputSchema,
  sealInternalVersionInputSchema,
  recordBaselineResponseSchema,
  sealInternalVersionResponseSchema,
  internalReviewResolutionResponseSchema,
  internalVersionResolutionResponseSchema,
  internalReviewStateResponseSchema,
  internalVersionListResponseSchema,
  internalVersionDetailResponseSchema,
  type RecordBaselineBinding,
  type SealInternalVersionBinding,
  type InternalReviewResolution,
  type InternalVersionResolution,
} from "@/features/product/internal-versions/contracts";
import {
  verifyInternalReviewReceipt,
  verifyInternalVersionReceipt,
  verifyInternalReviewResolution,
  verifyInternalVersionResolution,
  verifyInternalVersionDetail,
} from "@/features/product/internal-versions/integrity";
import {
  internalReviewUrl,
  internalReviewResolveUrl,
  internalVersionResolveUrl,
  internalVersionsUrl,
  internalVersionUrl,
  internalRevisionScopeSchema,
  type InternalRevisionScope,
} from "@/features/product/internal-versions/urls";
import { StudioClientError } from "../client";
import { readInternalResponse } from "./response";
import {
  freezeInternalBinding,
  freezeInternalRequest,
  freezeInternalValue,
  sameInternalBinding,
  type InternalRequest,
} from "./request";

export function validInternalHttpError(
  input: unknown,
  status: number,
  write: boolean,
) {
  const parsed = internalVersionHttpErrorSchema.safeParse(input);
  return parsed.success &&
    INTERNAL_VERSION_HTTP_STATUSES[parsed.data.code] === status &&
    (write || parsed.data.code !== "WRITE_OUTCOME_UNKNOWN")
    ? parsed.data
    : undefined;
}
export async function checkedInternalFetch<T>(
  path: string,
  options: RequestInit,
  check: (input: unknown, status: number) => T | Promise<T>,
  mode: "write" | "read" | "list",
): Promise<T> {
  const write = mode === "write",
    fallback = write ? "WRITE_OUTCOME_UNKNOWN" : "STUDIO_UNAVAILABLE";
  const controller = new AbortController(),
    external = options.signal;
  const deadline = performance.now() + L.operationDeadlineMs;
  let interrupt: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    interrupt = () => reject(new StudioClientError(fallback));
  });
  const abort = () => {
    controller.abort();
    interrupt?.();
  };
  external?.addEventListener("abort", abort, { once: true });
  if (external?.aborted) controller.abort();
  const timer = setTimeout(abort, L.operationDeadlineMs);
  const requestEpoch = captureStudioEpoch();
  const checkpoint = () => {
    if (!acceptsStudioEpoch(requestEpoch))
      throw new StudioClientError("STUDIO_REQUEST_STALE");
    if (controller.signal.aborted || performance.now() >= deadline)
      throw new StudioClientError(fallback);
  };
  try {
    checkpoint();
    const response = await Promise.race([
      fetch(path, {
        ...options,
        signal: controller.signal,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
      }),
      interrupted,
    ]);
    checkpoint();
    const value = await readInternalResponse(
      response,
      response.ok
        ? mode === "list"
          ? L.listResponseBytes
          : L.responseBytes
        : L.errorResponseBytes,
      { signal: controller.signal, deadlineMonotonicMs: deadline },
    );
    checkpoint();
    if (!response.ok) {
      const error = validInternalHttpError(value, response.status, write);
      throw new StudioClientError(error?.code ?? fallback);
    }
    if (!(write ? [200, 201] : [200]).includes(response.status))
      throw new StudioClientError(fallback);
    const result = await Promise.race([
      check(value, response.status),
      interrupted,
    ]);
    checkpoint();
    return freezeInternalValue(result);
  } catch (error) {
    if (error instanceof StudioClientError) throw error;
    throw new StudioClientError(fallback);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", abort);
    controller.abort();
  }
}
export async function checkReviewResult(
  value: unknown,
  status: number,
  input: RecordBaselineBinding,
) {
  const expected = freezeInternalBinding("review", input);
  const result = recordBaselineResponseSchema.parse(value).value;
  const receipt = await verifyInternalReviewReceipt(result.review);
  if (
    status !== (result.created ? 201 : 200) ||
    !sameInternalBinding("review", receipt.binding, expected)
  )
    throw Error("INTERNAL_REVIEW_MISMATCH");
  return { ...result, review: receipt };
}
export async function checkSealResult(
  value: unknown,
  status: number,
  input: SealInternalVersionBinding,
) {
  const expected = freezeInternalBinding("seal", input);
  const result = sealInternalVersionResponseSchema.parse(value).value;
  const receipt = await verifyInternalVersionReceipt(result.version);
  if (
    status !== (result.created ? 201 : 200) ||
    !sameInternalBinding("seal", receipt.binding, expected)
  )
    throw Error("INTERNAL_SEAL_MISMATCH");
  return { ...result, version: receipt };
}
export async function checkReviewResolution(
  value: unknown,
  input: RecordBaselineBinding,
): Promise<InternalReviewResolution> {
  const expected = freezeInternalBinding("review", input);
  const result = await verifyInternalReviewResolution(value);
  if (!sameInternalBinding("review", result.binding, expected))
    throw Error("INTERNAL_REVIEW_MISMATCH");
  return result;
}
export async function checkVersionResolution(
  value: unknown,
  input: SealInternalVersionBinding,
): Promise<InternalVersionResolution> {
  const expected = freezeInternalBinding("seal", input);
  const result = await verifyInternalVersionResolution(value);
  if (!sameInternalBinding("seal", result.binding, expected))
    throw Error("INTERNAL_SEAL_MISMATCH");
  return result;
}
function body(value: unknown) {
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > L.requestBytes)
    throw Error("INTERNAL_REQUEST_LIMIT");
  return text;
}
const post = (
  payload: string,
  csrf: string,
  signal?: AbortSignal,
): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", "x-csrf-token": csrf },
  body: payload,
  ...(signal ? { signal } : {}),
});
/** Prepare serialization before the sent/readback gate; invocation begins fetch synchronously. */
export function prepareRecordBaselineRequest(
  input: RecordBaselineBinding,
  csrf: string,
) {
  const binding = freezeInternalBinding("review", input);
  // Full binding also fits resolve/fingerprint and durable entry budgets.
  body(binding);
  const { productId, ...rest } = binding;
  const payload = body(recordBaselineInputSchema.parse(rest));
  const path = internalReviewUrl({
    productId,
    draftId: binding.target.draftId,
    revision: binding.target.revision,
  });
  return () =>
    checkedInternalFetch(
      path,
      post(payload, csrf),
      (v, status) => checkReviewResult(v, status, binding),
      "write",
    );
}
export function prepareSealInternalRequest(
  input: SealInternalVersionBinding,
  csrf: string,
) {
  const binding = freezeInternalBinding("seal", input);
  body(binding);
  const { productId, ...rest } = binding;
  const payload = body(sealInternalVersionInputSchema.parse(rest));
  const path = internalVersionsUrl(productId);
  return () =>
    checkedInternalFetch(
      path,
      post(payload, csrf),
      (v, status) => checkSealResult(v, status, binding),
      "write",
    );
}
export function resolveInternalReview(
  input: RecordBaselineBinding,
  csrf: string,
  signal: AbortSignal,
) {
  const binding = freezeInternalBinding("review", input);
  return checkedInternalFetch(
    internalReviewResolveUrl(binding.productId),
    post(body(binding), csrf, signal),
    (v) =>
      checkReviewResolution(
        internalReviewResolutionResponseSchema.parse(v).value,
        binding,
      ),
    "read",
  );
}
export function resolveInternalVersion(
  input: SealInternalVersionBinding,
  csrf: string,
  signal: AbortSignal,
) {
  const binding = freezeInternalBinding("seal", input);
  return checkedInternalFetch(
    internalVersionResolveUrl(binding.productId),
    post(body(binding), csrf, signal),
    (v) =>
      checkVersionResolution(
        internalVersionResolutionResponseSchema.parse(v).value,
        binding,
      ),
    "read",
  );
}
export async function checkReviewState(
  value: unknown,
  expected: InternalRevisionScope,
) {
  const scope = internalRevisionScopeSchema.parse(expected);
  const state = internalReviewStateResponseSchema.parse(value).value;
  if (
    state.productId !== scope.productId ||
    state.target.draftId !== scope.draftId ||
    state.target.revision !== scope.revision
  )
    throw Error("INTERNAL_REVIEW_SCOPE");
  if (state.review)
    state.review = await verifyInternalReviewReceipt(state.review);
  return state;
}
export function readInternalReviewState(
  input: InternalRevisionScope,
  signal: AbortSignal,
) {
  const scope = internalRevisionScopeSchema.parse(input);
  return checkedInternalFetch(
    internalReviewUrl(scope),
    { signal },
    (v) => checkReviewState(v, scope),
    "read",
  );
}
export function readInternalVersions(productId: string, signal: AbortSignal) {
  const path = internalVersionsUrl(productId);
  return checkedInternalFetch(
    path,
    { signal },
    (v) => {
      const result = internalVersionListResponseSchema.parse(v).value;
      if (result.productId !== productId) throw Error("INTERNAL_VERSION_SCOPE");
      return result;
    },
    "list",
  );
}
export function readInternalVersion(
  productId: string,
  versionId: string,
  signal: AbortSignal,
) {
  const path = internalVersionUrl(productId, versionId);
  return checkedInternalFetch(
    path,
    { signal },
    async (v) => {
      const result = await verifyInternalVersionDetail(
        internalVersionDetailResponseSchema.parse(v).value,
      );
      if (
        result.version.id !== versionId ||
        result.version.binding.productId !== productId
      )
        throw Error("INTERNAL_VERSION_SCOPE");
      return result;
    },
    "read",
  );
}
export function prepareInternalRequest(input: InternalRequest, csrf: string) {
  const request = freezeInternalRequest(input);
  if (request.operation === "review") {
    const send = prepareRecordBaselineRequest(request.tuple, csrf);
    return async () => ({ operation: "review" as const, ...(await send()) });
  }
  const send = prepareSealInternalRequest(request.tuple, csrf);
  return async () => ({ operation: "seal" as const, ...(await send()) });
}
