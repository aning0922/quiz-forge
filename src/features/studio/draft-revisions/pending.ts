import { z } from "zod";
import {
  DRAFT_REVISION_LIMITS,
  appendDraftBindingSchema,
  sameAppendDraftBinding,
  type AppendDraftBinding,
} from "@/features/product/draft-revisions/contracts";
import {
  acquireDraftProduct,
  readDraftPending,
  type DraftPendingStorage,
} from "../drafts/pending";

export const REVISION_PENDING_STORAGE_KEY =
  "quizforge.studio.draft-revisions.v1";
export const revisionPendingEntrySchema = z.strictObject({
  tuple: appendDraftBindingSchema,
  mayHaveBeenSent: z.boolean(),
});
const bucketSchema = z.strictObject({
  schemaVersion: z.literal("quizforge.studio.draft-revisions.v1"),
  entries: z
    .array(revisionPendingEntrySchema)
    .max(DRAFT_REVISION_LIMITS.pendingEntries),
});
export type RevisionPendingEntry = z.infer<typeof revisionPendingEntrySchema>;
export class RevisionPendingError extends Error {
  constructor() {
    super("REVISION_PENDING_UNAVAILABLE");
  }
}
export function freezeAppendBinding(value: unknown): AppendDraftBinding {
  const parsed = appendDraftBindingSchema.parse(value);
  return Object.freeze({
    ...parsed,
    target: Object.freeze({ ...parsed.target }),
  });
}
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
function encode(entries: readonly RevisionPendingEntry[]) {
  const bucket = bucketSchema.parse({
      schemaVersion: REVISION_PENDING_STORAGE_KEY,
      entries,
    }),
    seen = new Set<string>();
  for (const entry of bucket.entries) {
    if (
      seen.has(entry.tuple.productId) ||
      bytes(JSON.stringify(entry)) > DRAFT_REVISION_LIMITS.pendingEntryBytes
    )
      throw new RevisionPendingError();
    seen.add(entry.tuple.productId);
  }
  const text = JSON.stringify(bucket);
  if (bytes(text) > DRAFT_REVISION_LIMITS.pendingBucketBytes)
    throw new RevisionPendingError();
  return text;
}
export function readRevisionPending(
  storage: DraftPendingStorage,
): readonly RevisionPendingEntry[] {
  try {
    const text = storage.getItem(REVISION_PENDING_STORAGE_KEY);
    if (text === null) return [];
    if (
      text.length > DRAFT_REVISION_LIMITS.pendingBucketBytes ||
      bytes(text) > DRAFT_REVISION_LIMITS.pendingBucketBytes
    )
      throw new RevisionPendingError();
    const bucket = bucketSchema.parse(JSON.parse(text));
    encode(bucket.entries);
    return bucket.entries.map((e) =>
      Object.freeze({ ...e, tuple: freezeAppendBinding(e.tuple) }),
    );
  } catch {
    throw new RevisionPendingError();
  }
}
/** Shared with the legacy prepare path. This never rewrites or upgrades its bucket. */
export function assertNoRevisionPending(
  storage: DraftPendingStorage,
  productId: string,
) {
  if (readRevisionPending(storage).some((e) => e.tuple.productId === productId))
    throw new RevisionPendingError();
}
function assertNoLegacyPending(
  storage: DraftPendingStorage,
  productId: string,
) {
  if (readDraftPending(storage).some((e) => e.tuple.productId === productId))
    throw new RevisionPendingError();
}
export function inspectRevisionPreparation(
  storage: DraftPendingStorage,
  productId: string,
) {
  assertNoLegacyPending(storage, productId);
  assertNoRevisionPending(storage, productId);
}
declare const leaseBrand: unique symbol;
type Lease = Readonly<{ productId: string; [leaseBrand]: true }>;
const activeLeases = new WeakSet<Lease>();
/** Wraps the existing Product gate; the WeakSet validates handles, never duplicates its Product lock. */
export async function withRevisionProduct<T>(
  productId: string,
  run: (lease: Lease) => T | Promise<T>,
): Promise<T> {
  const release = acquireDraftProduct(productId),
    lease = Object.freeze({ productId }) as Lease;
  activeLeases.add(lease);
  try {
    return await run(lease);
  } finally {
    activeLeases.delete(lease);
    release();
  }
}
function mutate(
  lease: Lease,
  storage: DraftPendingStorage,
  change: (entries: RevisionPendingEntry[]) => RevisionPendingEntry[],
) {
  try {
    if (!activeLeases.has(lease)) throw new RevisionPendingError();
    const text = encode(change([...readRevisionPending(storage)]));
    storage.setItem(REVISION_PENDING_STORAGE_KEY, text);
    if (storage.getItem(REVISION_PENDING_STORAGE_KEY) !== text)
      throw new RevisionPendingError();
    readRevisionPending(storage);
  } catch {
    throw new RevisionPendingError();
  }
}
export function prepareRevisionPending(
  lease: Lease,
  storage: DraftPendingStorage,
  binding: AppendDraftBinding,
) {
  const tuple = freezeAppendBinding(binding);
  if (lease.productId !== tuple.productId) throw new RevisionPendingError();
  inspectRevisionPreparation(storage, tuple.productId);
  mutate(lease, storage, (entries) => [
    ...entries,
    { tuple, mayHaveBeenSent: false },
  ]);
}
export function markRevisionBeforeSend(
  lease: Lease,
  storage: DraftPendingStorage,
  binding: AppendDraftBinding,
  replay: boolean,
) {
  const tuple = freezeAppendBinding(binding);
  if (lease.productId !== tuple.productId) throw new RevisionPendingError();
  assertNoLegacyPending(storage, tuple.productId);
  mutate(lease, storage, (entries) => {
    const index = entries.findIndex(
        (e) => e.tuple.productId === tuple.productId,
      ),
      entry = entries[index];
    if (
      !entry ||
      !sameAppendDraftBinding(entry.tuple, tuple) ||
      (!replay && entry.mayHaveBeenSent)
    )
      throw new RevisionPendingError();
    entries[index] = { tuple, mayHaveBeenSent: true };
    return entries;
  });
}
export function hasExactRevisionPending(
  storage: DraftPendingStorage,
  binding: AppendDraftBinding,
) {
  return readRevisionPending(storage).some((e) =>
    sameAppendDraftBinding(e.tuple, binding),
  );
}
export function removeExactRevisionPending(
  lease: Lease,
  storage: DraftPendingStorage,
  binding: AppendDraftBinding,
) {
  if (lease.productId !== binding.productId) throw new RevisionPendingError();
  let removed = false;
  mutate(lease, storage, (entries) =>
    entries.filter((e) => {
      if (!sameAppendDraftBinding(e.tuple, binding)) return true;
      removed = true;
      return false;
    }),
  );
  return removed;
}
