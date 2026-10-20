import type {
  InternalReviewResolution,
  InternalVersionResolution,
} from "@/features/product/internal-versions/contracts";
import type { DraftPendingStorage } from "../drafts/pending";
import {
  checkReviewResolution,
  checkVersionResolution,
  prepareInternalRequest,
  resolveInternalReview,
  resolveInternalVersion,
} from "./client";
import { freezeInternalRequest, type InternalRequest } from "./request";
import {
  InternalPendingError,
  withInternalProduct,
  prepareInternalPending,
  markInternalBeforeSend,
  hasExactInternalPending,
  removeExactInternalPending,
} from "./pending";
export type InternalEvidence =
  | { operation: "review"; value: InternalReviewResolution }
  | { operation: "seal"; value: InternalVersionResolution };
function exact(storage: DraftPendingStorage, request: InternalRequest) {
  return hasExactInternalPending(storage, request.operation, request.tuple);
}
function requireCurrent(current: () => boolean) {
  if (!current()) throw new InternalPendingError();
}
/** Both actual success and all failures retain the original anchor until an explicit local action. */
export async function applyInternalOperation(
  storage: DraftPendingStorage,
  input: InternalRequest,
  csrf: string,
  current: () => boolean,
) {
  const request = freezeInternalRequest(input),
    send = prepareInternalRequest(request, csrf);
  return withInternalProduct(request.tuple.productId, async (lease) => {
    requireCurrent(current);
    prepareInternalPending(lease, storage, request.operation, request.tuple);
    markInternalBeforeSend(
      lease,
      storage,
      request.operation,
      request.tuple,
      false,
    );
    const result = await send();
    requireCurrent(current);
    if (!exact(storage, request)) throw new InternalPendingError();
    return result;
  });
}
export async function retryInternalOperation(
  storage: DraftPendingStorage,
  input: InternalRequest,
  csrf: string,
  current: () => boolean,
) {
  const request = freezeInternalRequest(input),
    send = prepareInternalRequest(request, csrf);
  return withInternalProduct(request.tuple.productId, async (lease) => {
    requireCurrent(current);
    markInternalBeforeSend(
      lease,
      storage,
      request.operation,
      request.tuple,
      true,
    );
    const result = await send();
    requireCurrent(current);
    if (!exact(storage, request)) throw new InternalPendingError();
    return result;
  });
}
/** Stable Product operation; no source/detail GET or current-head refresh is required. */
export async function resolveInternalPending(
  storage: DraftPendingStorage,
  input: InternalRequest,
  csrf: string,
  signal: AbortSignal,
  current: () => boolean,
): Promise<InternalEvidence> {
  const request = freezeInternalRequest(input);
  requireCurrent(current);
  if (!exact(storage, request)) throw new InternalPendingError();
  const evidence: InternalEvidence =
    request.operation === "review"
      ? {
          operation: "review",
          value: await resolveInternalReview(request.tuple, csrf, signal),
        }
      : {
          operation: "seal",
          value: await resolveInternalVersion(request.tuple, csrf, signal),
        };
  requireCurrent(current);
  if (!exact(storage, request)) throw new InternalPendingError();
  return evidence;
}
/** A successful write receipt can be displayed/explicitly cleared using the same strict proof path. */
export function evidenceFromWrite(
  result: Awaited<ReturnType<typeof applyInternalOperation>>,
): InternalEvidence {
  return result.operation === "review"
    ? {
        operation: "review",
        value: {
          kind: "recorded",
          binding: result.review.binding,
          fingerprint: result.review.fingerprint,
          review: result.review,
        },
      }
    : {
        operation: "seal",
        value: {
          kind: "sealed",
          binding: result.version.binding,
          fingerprint: result.version.fingerprint,
          version: result.version,
        },
      };
}
export async function clearConfirmedInternalPending(
  storage: DraftPendingStorage,
  input: InternalRequest,
  evidence: InternalEvidence,
  current: () => boolean,
) {
  const request = freezeInternalRequest(input);
  return withInternalProduct(request.tuple.productId, async (lease) => {
    requireCurrent(current);
    if (!exact(storage, request) || request.operation !== evidence.operation)
      throw new InternalPendingError();
    const checked =
      request.operation === "review" && evidence.operation === "review"
        ? await checkReviewResolution(evidence.value, request.tuple)
        : request.operation === "seal" && evidence.operation === "seal"
          ? await checkVersionResolution(evidence.value, request.tuple)
          : undefined;
    requireCurrent(current);
    if (!checked || checked.kind === "unresolved" || !exact(storage, request))
      throw new InternalPendingError();
    if (
      !removeExactInternalPending(
        lease,
        storage,
        request.operation,
        request.tuple,
      )
    )
      throw new InternalPendingError();
  });
}
export type InternalOperationTicket = Readonly<{
  generation: number;
  request: InternalRequest;
}>;
/** Private monotonic Product epoch; cloned tickets and late responses have no acceptance authority. */
export class InternalOperationEpoch {
  private generation = 0;
  private active: InternalOperationTicket | undefined;
  constructor(readonly productId: string) {}
  invalidate() {
    this.generation++;
    this.active = undefined;
  }
  begin(input: InternalRequest) {
    const request = freezeInternalRequest(input);
    if (request.tuple.productId !== this.productId)
      throw new InternalPendingError();
    this.invalidate();
    this.active = Object.freeze({ generation: this.generation, request });
    return this.active;
  }
  accepts(ticket: InternalOperationTicket) {
    return this.active === ticket && ticket.generation === this.generation;
  }
}
