import { captureStudioEpoch, acceptsStudioEpoch } from "../authority-events";
import { StudioClientError } from "../client";
import {
  applyReadyValidationSchema,
  type DraftApplicationBinding,
} from "@/features/product/drafts/contracts";
import {
  acquireDraftProduct,
  addDraftPrepared,
  freezeDraftBinding,
  markDraftBeforeSend,
  removeExactDraftPending,
  type DraftPendingStorage,
} from "./pending";
import {
  applyDraftEndpoint,
  checkApplyDraft,
  checkedDraftFetch,
  checkDraftApplication,
  draftApplicationEndpoint,
} from "./client";
import { assertNoRevisionPending } from "../draft-revisions/pending";
function send(
  storage: DraftPendingStorage,
  tuple: DraftApplicationBinding,
  csrf: string,
  replay: boolean,
) {
  markDraftBeforeSend(storage, tuple, replay);
  // No await or callback between the persisted sent/readback gate and fetch.
  const body = applyReadyValidationSchema.parse({
    idempotencyKey: tuple.idempotencyKey,
    expectedValidationStateRevision: tuple.expectedValidationStateRevision,
    expectedCandidateSha256: tuple.expectedCandidateSha256,
    target: tuple.target,
  });
  return checkedDraftFetch(
    applyDraftEndpoint(tuple),
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify(body),
    },
    (value, status) => checkApplyDraft(value, status, tuple),
    { write: true },
  );
}
export async function applyFirstDraft(
  storage: DraftPendingStorage,
  input: DraftApplicationBinding,
  csrf: string,
) {
  const authorityEpoch = captureStudioEpoch();
  const tuple = freezeDraftBinding(input),
    release = acquireDraftProduct(tuple.productId);
  try {
    assertNoRevisionPending(storage, tuple.productId);
    addDraftPrepared(storage, tuple);
    const result = await send(storage, tuple, csrf, false);
    if (!acceptsStudioEpoch(authorityEpoch))
      throw new StudioClientError("WRITE_OUTCOME_UNKNOWN");
    removeExactDraftPending(storage, tuple);
    return result;
  } finally {
    release();
  }
}
/** Explicit user action only: the exact persisted key/tuple is the sole replay exception. */
export async function retryOriginalDraft(
  storage: DraftPendingStorage,
  input: DraftApplicationBinding,
  csrf: string,
) {
  const authorityEpoch = captureStudioEpoch();
  const tuple = freezeDraftBinding(input),
    release = acquireDraftProduct(tuple.productId);
  try {
    const result = await send(storage, tuple, csrf, true);
    if (!acceptsStudioEpoch(authorityEpoch))
      throw new StudioClientError("WRITE_OUTCOME_UNKNOWN");
    removeExactDraftPending(storage, tuple);
    return result;
  } finally {
    release();
  }
}
export async function reconcileDraftPending(
  storage: DraftPendingStorage,
  input: DraftApplicationBinding,
) {
  const authorityEpoch = captureStudioEpoch();
  const tuple = freezeDraftBinding(input),
    release = acquireDraftProduct(tuple.productId);
  try {
    const result = await checkedDraftFetch(
      draftApplicationEndpoint(tuple.productId, tuple.idempotencyKey),
      {},
      (value) => checkDraftApplication(value, tuple),
    );
    if (!acceptsStudioEpoch(authorityEpoch))
      throw new StudioClientError("WRITE_OUTCOME_UNKNOWN");
    if (result.kind === "applied") removeExactDraftPending(storage, tuple);
    return result;
  } finally {
    release();
  }
}
