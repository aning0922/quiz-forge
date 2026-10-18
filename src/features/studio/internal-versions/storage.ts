import { z } from "zod";
import {
  INTERNAL_VERSION_LIMITS as L,
  recordBaselineBindingSchema,
  sealInternalVersionBindingSchema,
} from "@/features/product/internal-versions/contracts";
import type { DraftPendingStorage } from "../drafts/pending";
import {
  freezeInternalBinding,
  type InternalBindings,
  type InternalOperation,
} from "./request";
export const REVIEW_PENDING_STORAGE_KEY = "quizforge.studio.review-record.v1";
export const SEAL_PENDING_STORAGE_KEY = "quizforge.studio.version-seal.v1";
export const INTERNAL_PENDING_KEYS = Object.freeze({
  review: REVIEW_PENDING_STORAGE_KEY,
  seal: SEAL_PENDING_STORAGE_KEY,
});
export const reviewPendingEntrySchema = z.strictObject({
  tuple: recordBaselineBindingSchema,
  mayHaveBeenSent: z.boolean(),
});
export const sealPendingEntrySchema = z.strictObject({
  tuple: sealInternalVersionBindingSchema,
  mayHaveBeenSent: z.boolean(),
});
const reviewBucket = z.strictObject({
  schemaVersion: z.literal(REVIEW_PENDING_STORAGE_KEY),
  entries: reviewPendingEntrySchema.array().max(L.pendingEntries),
});
const sealBucket = z.strictObject({
  schemaVersion: z.literal(SEAL_PENDING_STORAGE_KEY),
  entries: sealPendingEntrySchema.array().max(L.pendingEntries),
});
export type InternalPendingEntry<
  O extends InternalOperation = InternalOperation,
> = Readonly<{ tuple: InternalBindings[O]; mayHaveBeenSent: boolean }>;
export class InternalPendingError extends Error {
  constructor() {
    super("INTERNAL_PENDING_UNAVAILABLE");
  }
}
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
/** Internal bucket encoder; mutations are performed only by the existing Product-gate lease. */
export function encodeInternalPending(
  operation: InternalOperation,
  entries: readonly InternalPendingEntry[],
) {
  const bucket = (operation === "review" ? reviewBucket : sealBucket).parse({
    schemaVersion: INTERNAL_PENDING_KEYS[operation],
    entries,
  });
  const seen = new Set<string>();
  for (const entry of bucket.entries) {
    if (
      seen.has(entry.tuple.productId) ||
      bytes(JSON.stringify(entry)) > L.pendingEntryBytes
    )
      throw new InternalPendingError();
    seen.add(entry.tuple.productId);
  }
  const text = JSON.stringify(bucket);
  if (bytes(text) > L.pendingBucketBytes) throw new InternalPendingError();
  return text;
}
export function readInternalPending<O extends InternalOperation>(
  storage: DraftPendingStorage,
  operation: O,
): readonly InternalPendingEntry<O>[] {
  try {
    const text = storage.getItem(INTERNAL_PENDING_KEYS[operation]);
    if (text === null) return [];
    if (
      text.length > L.pendingBucketBytes ||
      bytes(text) > L.pendingBucketBytes
    )
      throw new InternalPendingError();
    const bucket = (operation === "review" ? reviewBucket : sealBucket).parse(
      JSON.parse(text),
    );
    encodeInternalPending(operation, bucket.entries);
    return bucket.entries.map((entry) =>
      Object.freeze({
        tuple: freezeInternalBinding(operation, entry.tuple),
        mayHaveBeenSent: entry.mayHaveBeenSent,
      }),
    );
  } catch {
    throw new InternalPendingError();
  }
}
/** New preparation only. Original-key reads do not inspect unrelated protocol buckets. */
export function assertNoInternalPending(
  storage: DraftPendingStorage,
  productId: string,
) {
  for (const operation of ["review", "seal"] as const)
    if (
      readInternalPending(storage, operation).some(
        (entry) => entry.tuple.productId === productId,
      )
    )
      throw new InternalPendingError();
}
