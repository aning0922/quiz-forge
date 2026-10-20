import { z } from "zod";
import { preparedValidationDtoSchema } from "@/features/quizpack/validation/contracts";

export const PENDING_STORAGE_KEY = "quizforge-validation-pending.v1";
export const pendingTupleSchema = preparedValidationDtoSchema
  .omit({ validationKey: true })
  .extend({
    expectedValidationKey: preparedValidationDtoSchema.shape.validationKey,
  });
export const pendingEntrySchema = z.strictObject({
  tuple: pendingTupleSchema,
  mayHaveBeenSent: z.boolean(),
});
const bucketSchema = z.strictObject({
  schemaVersion: z.literal("quizforge-validation-pending.v1"),
  entries: z.array(pendingEntrySchema).max(16),
});
export type PendingTuple = z.infer<typeof pendingTupleSchema>;
export type PendingEntry = z.infer<typeof pendingEntrySchema>;
type Bucket = z.infer<typeof bucketSchema>;
export type PendingStorage = Pick<Storage, "getItem" | "setItem">;
export class PendingStoreError extends Error {
  constructor() {
    super("PENDING_STORAGE_UNAVAILABLE");
  }
}
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const pair = (tuple: Pick<PendingTuple, "productId" | "importId">) =>
  JSON.stringify([tuple.productId, tuple.importId]);
function ordered(tuple: PendingTuple): PendingTuple {
  return {
    productId: tuple.productId,
    importId: tuple.importId,
    expectedImportStateRevision: tuple.expectedImportStateRevision,
    archiveSha256: tuple.archiveSha256,
    archiveBytes: tuple.archiveBytes,
    identitySha256: tuple.identitySha256,
    expectedValidationKey: tuple.expectedValidationKey,
  };
}
export function sameTuple(a: PendingTuple, b: PendingTuple): boolean {
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
}
function encode(bucket: Bucket): string {
  const parsed = bucketSchema.parse(bucket);
  const seen = new Set<string>();
  const entries = parsed.entries.map((entry) => {
    const key = pair(entry.tuple);
    if (seen.has(key)) throw new PendingStoreError();
    seen.add(key);
    const value = {
      tuple: ordered(entry.tuple),
      mayHaveBeenSent: entry.mayHaveBeenSent,
    };
    if (bytes(JSON.stringify(value)) > 4096) throw new PendingStoreError();
    return value;
  });
  const text = JSON.stringify({ schemaVersion: parsed.schemaVersion, entries });
  if (bytes(text) > 65536) throw new PendingStoreError();
  return text;
}
export function readPending(storage: PendingStorage): readonly PendingEntry[] {
  try {
    const text = storage.getItem(PENDING_STORAGE_KEY);
    if (text === null) return [];
    if (text.length > 65536 || bytes(text) > 65536)
      throw new PendingStoreError();
    const bucket = bucketSchema.parse(JSON.parse(text));
    encode(bucket);
    return bucket.entries;
  } catch {
    throw new PendingStoreError();
  }
}
function mutate(
  storage: PendingStorage,
  change: (entries: PendingEntry[]) => PendingEntry[],
) {
  try {
    const entries = change([...readPending(storage)]);
    const text = encode({
      schemaVersion: "quizforge-validation-pending.v1",
      entries,
    });
    storage.setItem(PENDING_STORAGE_KEY, text);
    // Full bucket readback, including other pairs. A failed write is never rolled back.
    if (storage.getItem(PENDING_STORAGE_KEY) !== text)
      throw new PendingStoreError();
    readPending(storage);
  } catch {
    throw new PendingStoreError();
  }
}
const gates = new Set<string>();
/** Synchronous document-wide exclusion; callers hold this across prepare/start promises. */
export function acquirePair(
  tuple: Pick<PendingTuple, "productId" | "importId">,
): () => void {
  const key = pair(tuple);
  if (gates.has(key)) throw new PendingStoreError();
  gates.add(key);
  return () => {
    gates.delete(key);
  };
}
export function addPrepared(storage: PendingStorage, input: PendingTuple) {
  const tuple = pendingTupleSchema.parse(input);
  mutate(storage, (entries) => {
    const existing = entries.find((entry) => pair(entry.tuple) === pair(tuple));
    if (existing) {
      if (!sameTuple(existing.tuple, tuple) || existing.mayHaveBeenSent)
        throw new PendingStoreError();
      return entries;
    }
    return [...entries, { tuple: ordered(tuple), mayHaveBeenSent: false }];
  });
}
/** No await between this call and the first fetch. The pair gate must already be held. */
export function markBeforeStart(storage: PendingStorage, tuple: PendingTuple) {
  if (!gates.has(pair(tuple))) throw new PendingStoreError();
  mutate(storage, (entries) => {
    const index = entries.findIndex((entry) => sameTuple(entry.tuple, tuple));
    if (index < 0 || entries[index]!.mayHaveBeenSent)
      throw new PendingStoreError();
    entries[index] = { tuple: ordered(tuple), mayHaveBeenSent: true };
    return entries;
  });
}
export function removeExact(
  storage: PendingStorage,
  tuple: PendingTuple,
  sent: boolean,
): boolean {
  let removed = false;
  mutate(storage, (entries) =>
    entries.filter((entry) => {
      const match =
        sameTuple(entry.tuple, tuple) && entry.mayHaveBeenSent === sent;
      if (match) removed = true;
      return !match;
    }),
  );
  return removed;
}
export function cancelPrepared(
  storage: PendingStorage,
  tuple: PendingTuple,
): boolean {
  const release = acquirePair(tuple);
  try {
    return removeExact(storage, tuple, false);
  } finally {
    release();
  }
}
