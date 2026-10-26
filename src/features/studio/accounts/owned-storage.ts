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
