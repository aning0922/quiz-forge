import "server-only";
import { StudioError } from "@/lib/http-security/errors";
import { heldRows } from "../import/repository";
import { heldValidations } from "./repository";
import { importHeldStorageRows, type HeldStorageRow } from "../import/quota";
import type { StorageLock } from "../import/storage-lock";
/** Each query has its own limit+1 bound and shares the same owned lock and operation budget. */
export async function readHeldStorageRows(
  lock: StorageLock,
  caller: "receive" | "validation",
): Promise<HeldStorageRow[]> {
  try {
    const imports = await lock.query(() => heldRows(lock.connection));
    const validations = await lock.query(() =>
      heldValidations(lock.connection),
    );
    lock.assert();
    return [
      ...importHeldStorageRows(imports),
      ...validations.map((row) => ({
        namespace: row.namespace,
        id: row.id,
        reservedBytes: row.reservedBytes,
        attempts: row.attempts,
        assetBlobHashes: row.assetBlobHashes,
      })),
    ];
  } catch (error) {
    if (caller === "receive" && error instanceof StudioError) {
      if (error.code === "VALIDATION_SCAN_LIMIT")
        throw new StudioError("RECEIVE_SCAN_LIMIT");
      if (error.code === "VALIDATION_STORAGE_CONFLICT")
        throw new StudioError("RECEIVE_STORAGE_CONFLICT");
    }
    throw error;
  }
}
