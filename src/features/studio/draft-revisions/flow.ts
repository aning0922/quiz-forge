import {
  type AppendDraftBinding,
  type DraftRevisionResolution,
} from "@/features/product/draft-revisions/contracts";
import type { DraftPendingStorage } from "../drafts/pending";
import {
  prepareAppendRequest,
  resolveRevision,
  checkRevisionResolution,
} from "./client";
import {
  withRevisionProduct,
  freezeAppendBinding,
  prepareRevisionPending,
  markRevisionBeforeSend,
  removeExactRevisionPending,
  hasExactRevisionPending,
  RevisionPendingError,
} from "./pending";

export async function applyAppendRevision(
  storage: DraftPendingStorage,
  input: AppendDraftBinding,
  csrf: string,
) {
  const tuple = freezeAppendBinding(input),
    send = prepareAppendRequest(tuple, csrf);
  return withRevisionProduct(tuple.productId, async (lease) => {
    prepareRevisionPending(lease, storage, tuple);
    markRevisionBeforeSend(lease, storage, tuple, false);
    const result = await send();
    removeExactRevisionPending(lease, storage, tuple);
    return result;
  });
}
export async function retryAppendRevision(
  storage: DraftPendingStorage,
  input: AppendDraftBinding,
  csrf: string,
) {
  const tuple = freezeAppendBinding(input),
    send = prepareAppendRequest(tuple, csrf);
  return withRevisionProduct(tuple.productId, async (lease) => {
    markRevisionBeforeSend(lease, storage, tuple, true);
    const result = await send();
    removeExactRevisionPending(lease, storage, tuple);
    return result;
  });
}
/** Read-only: it may display evidence but never removes an anchor on its own. */
export async function resolvePendingRevision(
  storage: DraftPendingStorage,
  input: AppendDraftBinding,
  csrf: string,
  signal: AbortSignal,
) {
  const tuple = freezeAppendBinding(input);
  if (!hasExactRevisionPending(storage, tuple))
    throw new RevisionPendingError();
  const result = await resolveRevision(tuple, csrf, signal);
  if (!hasExactRevisionPending(storage, tuple))
    throw new RevisionPendingError();
  return result;
}
/** Explicit local action only; late or changed storage cannot delete another request. */
export async function clearResolvedRevision(
  storage: DraftPendingStorage,
  input: AppendDraftBinding,
  resolution: DraftRevisionResolution,
  current: () => boolean,
) {
  const tuple = freezeAppendBinding(input);
  return withRevisionProduct(tuple.productId, async (lease) => {
    if (!current()) throw new RevisionPendingError();
    const checked = await checkRevisionResolution(resolution, tuple);
    if (
      checked.kind === "unresolved" ||
      !current() ||
      !hasExactRevisionPending(storage, tuple)
    )
      throw new RevisionPendingError();
    if (!removeExactRevisionPending(lease, storage, tuple))
      throw new RevisionPendingError();
  });
}
export type RevisionTicket = Readonly<{
  generation: number;
  binding: AppendDraftBinding;
}>;
export class RevisionEpoch {
  private generation = 0;
  private active: RevisionTicket | undefined;
  constructor(readonly productId: string) {}
  invalidate() {
    this.generation++;
    this.active = undefined;
  }
  begin(input: AppendDraftBinding): RevisionTicket {
    const binding = freezeAppendBinding(input);
    if (binding.productId !== this.productId) throw new RevisionPendingError();
    this.invalidate();
    this.active = Object.freeze({ generation: this.generation, binding });
    return this.active;
  }
  accepts(ticket: RevisionTicket) {
    return this.active === ticket && this.generation === ticket.generation;
  }
}
