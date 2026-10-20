import {
  acquireDraftProduct,
  readDraftPending,
  type DraftPendingStorage,
} from "../drafts/pending";
import { readRevisionPending } from "../draft-revisions/pending";
import {
  freezeInternalBinding,
  sameInternalBinding,
  type InternalBindings,
  type InternalOperation,
} from "./request";
import {
  INTERNAL_PENDING_KEYS,
  InternalPendingError,
  assertNoInternalPending,
  encodeInternalPending,
  readInternalPending,
  type InternalPendingEntry,
} from "./storage";
export {
  INTERNAL_PENDING_KEYS,
  REVIEW_PENDING_STORAGE_KEY,
  SEAL_PENDING_STORAGE_KEY,
  InternalPendingError,
  readInternalPending,
} from "./storage";
export type { InternalPendingEntry } from "./storage";
export function inspectInternalPreparation(
  storage: DraftPendingStorage,
  productId: string,
) {
  try {
    if (
      readDraftPending(storage).some((e) => e.tuple.productId === productId) ||
      readRevisionPending(storage).some((e) => e.tuple.productId === productId)
    )
      throw new InternalPendingError();
    assertNoInternalPending(storage, productId);
  } catch {
    throw new InternalPendingError();
  }
}
declare const leaseBrand: unique symbol;
type Lease = Readonly<{ productId: string; [leaseBrand]: true }>;
const leases = new WeakSet<Lease>();
/** Handle validation only: all four protocols still share acquireDraftProduct's single lock. */
export async function withInternalProduct<T>(
  productId: string,
  run: (lease: Lease) => T | Promise<T>,
) {
  const release = acquireDraftProduct(productId),
    lease = Object.freeze({ productId }) as Lease;
  leases.add(lease);
  try {
    return await run(lease);
  } finally {
    leases.delete(lease);
    release();
  }
}
function mutate<O extends InternalOperation>(
  lease: Lease,
  storage: DraftPendingStorage,
  operation: O,
  change: (entries: InternalPendingEntry<O>[]) => InternalPendingEntry<O>[],
) {
  try {
    if (!leases.has(lease)) throw new InternalPendingError();
    const text = encodeInternalPending(
      operation,
      change([...readInternalPending(storage, operation)]),
    );
    storage.setItem(INTERNAL_PENDING_KEYS[operation], text);
    if (storage.getItem(INTERNAL_PENDING_KEYS[operation]) !== text)
      throw new InternalPendingError();
    readInternalPending(storage, operation);
  } catch {
    throw new InternalPendingError();
  }
}
export function prepareInternalPending<O extends InternalOperation>(
  lease: Lease,
  storage: DraftPendingStorage,
  operation: O,
  input: InternalBindings[O],
) {
  const tuple = freezeInternalBinding(operation, input);
  if (lease.productId !== tuple.productId) throw new InternalPendingError();
  inspectInternalPreparation(storage, tuple.productId);
  mutate(lease, storage, operation, (entries) => [
    ...entries,
    { tuple, mayHaveBeenSent: false },
  ]);
}
export function markInternalBeforeSend<O extends InternalOperation>(
  lease: Lease,
  storage: DraftPendingStorage,
  operation: O,
  input: InternalBindings[O],
  replay: boolean,
) {
  const tuple = freezeInternalBinding(operation, input);
  if (lease.productId !== tuple.productId) throw new InternalPendingError();
  mutate(lease, storage, operation, (entries) => {
    const index = entries.findIndex(
        (e) => e.tuple.productId === tuple.productId,
      ),
      entry = entries[index];
    if (
      !entry ||
      !sameInternalBinding(operation, entry.tuple, tuple) ||
      (!replay && entry.mayHaveBeenSent)
    )
      throw new InternalPendingError();
    entries[index] = { tuple, mayHaveBeenSent: true };
    return entries;
  });
}
export function hasExactInternalPending<O extends InternalOperation>(
  storage: DraftPendingStorage,
  operation: O,
  input: InternalBindings[O],
) {
  return readInternalPending(storage, operation).some((e) =>
    sameInternalBinding(operation, e.tuple, input),
  );
}
/** Exact original tuple only. The caller must recheck strict proof and current generation first. */
export function removeExactInternalPending<O extends InternalOperation>(
  lease: Lease,
  storage: DraftPendingStorage,
  operation: O,
  input: InternalBindings[O],
) {
  const tuple = freezeInternalBinding(operation, input);
  if (lease.productId !== tuple.productId) throw new InternalPendingError();
  let removed = false;
  mutate(lease, storage, operation, (entries) =>
    entries.filter((e) => {
      if (!sameInternalBinding(operation, e.tuple, tuple)) return true;
      removed = true;
      return false;
    }),
  );
  return removed;
}
