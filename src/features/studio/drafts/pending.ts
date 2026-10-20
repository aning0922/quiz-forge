import { z } from "zod";
import {
  DRAFT_LIMITS,
  draftApplicationBindingSchema,
  draftApplicationScopeSchema,
  type DraftApplicationBinding,
} from "@/features/product/drafts/contracts";
export const DRAFT_PENDING_STORAGE_KEY =
  "quizforge.studio.draft-applications.v1";
export const draftPendingEntrySchema = z.strictObject({
  tuple: draftApplicationBindingSchema,
  mayHaveBeenSent: z.boolean(),
});
const bucketSchema = z.strictObject({
  schemaVersion: z.literal("quizforge.studio.draft-applications.v1"),
  entries: z.array(draftPendingEntrySchema).max(DRAFT_LIMITS.pendingEntries),
});
export type DraftPendingEntry = z.infer<typeof draftPendingEntrySchema>;
export type DraftPendingStorage = Pick<Storage, "getItem" | "setItem">;
export class DraftPendingError extends Error {
  constructor() {
    super("DRAFT_PENDING_UNAVAILABLE");
  }
}
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
export function freezeDraftBinding(value: unknown): DraftApplicationBinding {
  const parsed = draftApplicationBindingSchema.parse(value);
  return Object.freeze({
    ...parsed,
    target: Object.freeze({ ...parsed.target }),
  });
}
export function sameDraftBinding(
  a: DraftApplicationBinding,
  b: DraftApplicationBinding,
) {
  // Strict parsing produces a fixed field order and never includes credentials.
  return (
    JSON.stringify(draftApplicationBindingSchema.parse(a)) ===
    JSON.stringify(draftApplicationBindingSchema.parse(b))
  );
}
function encode(entries: readonly DraftPendingEntry[]): string {
  const bucket = bucketSchema.parse({
    schemaVersion: "quizforge.studio.draft-applications.v1",
    entries,
  });
  const seen = new Set<string>();
  for (const entry of bucket.entries) {
    if (
      seen.has(entry.tuple.productId) ||
      bytes(JSON.stringify(entry)) > DRAFT_LIMITS.pendingEntryBytes
    )
      throw new DraftPendingError();
    seen.add(entry.tuple.productId);
  }
  const text = JSON.stringify(bucket);
  if (bytes(text) > DRAFT_LIMITS.pendingBucketBytes)
    throw new DraftPendingError();
  return text;
}
export function readDraftPending(
  storage: DraftPendingStorage,
): readonly DraftPendingEntry[] {
  try {
    const text = storage.getItem(DRAFT_PENDING_STORAGE_KEY);
    if (text === null) return [];
    if (
      text.length > DRAFT_LIMITS.pendingBucketBytes ||
      bytes(text) > DRAFT_LIMITS.pendingBucketBytes
    )
      throw new DraftPendingError();
    const bucket = bucketSchema.parse(JSON.parse(text));
    encode(bucket.entries);
    return bucket.entries.map((entry) =>
      Object.freeze({ ...entry, tuple: freezeDraftBinding(entry.tuple) }),
    );
  } catch {
    throw new DraftPendingError();
  }
}
function mutate(
  storage: DraftPendingStorage,
  change: (entries: DraftPendingEntry[]) => DraftPendingEntry[],
) {
  try {
    const text = encode(change([...readDraftPending(storage)]));
    storage.setItem(DRAFT_PENDING_STORAGE_KEY, text);
    if (storage.getItem(DRAFT_PENDING_STORAGE_KEY) !== text)
      throw new DraftPendingError();
    readDraftPending(storage);
  } catch {
    throw new DraftPendingError();
  }
}
const gates = new Set<string>();
export function acquireDraftProduct(productId: string): () => void {
  const id = draftApplicationScopeSchema.shape.productId.parse(productId);
  if (gates.has(id)) throw new DraftPendingError();
  gates.add(id);
  return () => gates.delete(id);
}
export function addDraftPrepared(
  storage: DraftPendingStorage,
  input: DraftApplicationBinding,
) {
  const tuple = freezeDraftBinding(input);
  if (!gates.has(tuple.productId)) throw new DraftPendingError();
  mutate(storage, (entries) => {
    if (entries.some((entry) => entry.tuple.productId === tuple.productId))
      throw new DraftPendingError();
    return [...entries, { tuple, mayHaveBeenSent: false }];
  });
}
/** Synchronous full readback immediately precedes fetch; replay never lowers sent to false. */
export function markDraftBeforeSend(
  storage: DraftPendingStorage,
  input: DraftApplicationBinding,
  replay: boolean,
) {
  const tuple = freezeDraftBinding(input);
  if (!gates.has(tuple.productId)) throw new DraftPendingError();
  mutate(storage, (entries) => {
    const index = entries.findIndex(
      (entry) => entry.tuple.productId === tuple.productId,
    );
    if (
      index < 0 ||
      !sameDraftBinding(entries[index]!.tuple, tuple) ||
      (!replay && entries[index]!.mayHaveBeenSent)
    )
      throw new DraftPendingError();
    entries[index] = { tuple, mayHaveBeenSent: true };
    return entries;
  });
}
/** Call only after a strict successful receipt matched the complete original tuple. */
export function removeExactDraftPending(
  storage: DraftPendingStorage,
  input: DraftApplicationBinding,
): boolean {
  const tuple = freezeDraftBinding(input);
  let removed = false;
  mutate(storage, (entries) =>
    entries.filter((entry) => {
      if (!sameDraftBinding(entry.tuple, tuple)) return true;
      removed = true;
      return false;
    }),
  );
  return removed;
}
