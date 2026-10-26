import type { DraftPendingStorage } from "../drafts/pending";
/** An owned envelope wraps existing bytes; original tuples/fingerprints are not rewritten. */
export function ownedPendingStorage(
  storage: DraftPendingStorage,
  operatorId: string,
): DraftPendingStorage {
  if (!operatorId || operatorId.length > 160)
    throw Error("PENDING_OWNER_INVALID");
  const prefix = `quizforge.studio.owned.v1:${operatorId}:`;
  return {
    getItem(key) {
      const raw = storage.getItem(prefix + key);
      if (raw === null) return null;
      const value = JSON.parse(raw) as {
        schemaVersion: string;
        operatorId: string;
        payload: string;
      };
      if (
        value.schemaVersion !== "quizforge.studio.owned-pending.v1" ||
        value.operatorId !== operatorId ||
        typeof value.payload !== "string"
      )
        throw Error("PENDING_OWNER_MISMATCH");
      return value.payload;
    },
    setItem(key, payload) {
      storage.setItem(
        prefix + key,
        JSON.stringify({
          schemaVersion: "quizforge.studio.owned-pending.v1",
          operatorId,
          payload,
        }),
      );
    },
  };
}
export const legacyPendingKeys = [
  "quizforge-validation-pending.v1",
  "quizforge.studio.draft-applications.v1",
  "quizforge.studio.draft-revisions.v1",
  "quizforge.studio.review-record.v1",
  "quizforge.studio.version-seal.v1",
] as const;
export function hasUnownedPending(storage: Pick<Storage, "getItem">) {
  return legacyPendingKeys.some((key) => {
    const raw = storage.getItem(key);
    if (!raw) return false;
    try {
      const value = JSON.parse(raw) as { entries?: unknown[] };
      return !Array.isArray(value.entries) || value.entries.length > 0;
    } catch {
      return true;
    }
  });
}
