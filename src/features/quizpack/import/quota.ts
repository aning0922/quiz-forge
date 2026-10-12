import "server-only";
import path from "node:path";
import { StudioError } from "@/lib/http-security/errors";
import type { ImportRow } from "./repository";
import {
  scannedFiles,
  storageScanKey,
  storageNamespaceLimits,
  type Scan,
  type StorageScanKey,
} from "./storage";
import {
  UPLOAD_QUOTA_BYTES,
  MAX_FILES_PER_IMPORT,
  MAX_SCAN_ENTRIES,
} from "./limits";

/** Repository projections only. An unknown validation plan reserves 64 future blob names. */
export type HeldStorageRow = {
  namespace: "imports" | "validation";
  id: string;
  reservedBytes: number;
  attempts: readonly {
    attemptId: string;
    reservationBytes: number;
    disposition: "held" | "released";
  }[];
  assetBlobHashes: readonly string[] | null;
};
export function importHeldStorageRows(
  rows: readonly ImportRow[],
): HeldStorageRow[] {
  return rows.map((row) => ({
    namespace: "imports",
    id: row.id,
    reservedBytes: Number(row.reserved_bytes),
    attempts: row.attempts,
    assetBlobHashes: null,
  }));
}
function heldAttempts(row: HeldStorageRow) {
  const held = row.attempts.filter((a) => a.disposition === "held");
  if (
    !Number.isSafeInteger(row.reservedBytes) ||
    row.reservedBytes < 0 ||
    held.some(
      (a) =>
        !Number.isSafeInteger(a.reservationBytes) || a.reservationBytes < 1,
    ) ||
    held.reduce((n, a) => n + a.reservationBytes, 0) !== row.reservedBytes
  )
    throw new StudioError("RECEIVE_STORAGE_CONFLICT");
  return held;
}
/** Every file name counts. Only the same namespace and attempt's partial offsets reservation. */
export function measuredStorageQuota(
  scan: Scan,
  rows: readonly HeldStorageRow[],
): number {
  let bytes = scan.bytes;
  const seen = new Set<StorageScanKey>();
  for (const row of rows) {
    const key = storageScanKey(row.namespace, row.id);
    if (seen.has(key)) throw new StudioError("RECEIVE_STORAGE_CONFLICT");
    seen.add(key);
    for (const attempt of heldAttempts(row)) {
      const owned = scannedFiles(scan, row.namespace, row.id)
        .filter(
          (f) =>
            path.basename(f.file) === `attempt-${attempt.attemptId}.partial`,
        )
        .reduce((n, f) => n + f.size, 0);
      bytes += Math.max(0, attempt.reservationBytes - owned);
      if (!Number.isSafeInteger(bytes))
        throw new StudioError("RECEIVE_STORAGE_CONFLICT");
    }
  }
  return bytes;
}
export function measuredQuota(scan: Scan, rows: ImportRow[]): number {
  return measuredStorageQuota(scan, importHeldStorageRows(rows));
}
export function requireQuota(bytes: number, added = 0) {
  if (
    !Number.isSafeInteger(bytes) ||
    !Number.isSafeInteger(added) ||
    bytes < 0 ||
    added < 0 ||
    bytes + added > UPLOAD_QUOTA_BYTES
  )
    throw new StudioError("RECEIVE_QUOTA_EXCEEDED");
}
export type StorageAdmission = {
  namespace: "imports" | "validation";
  id: string;
  /** Fresh validate uses null; archive retry uses the frozen distinct hash plan. */
  assetBlobHashes: readonly string[] | null;
};
/** One global byte/name ledger for receive and validation; recover does not require new admission. */
export function requireStorageCapacity(
  scan: Scan,
  rows: readonly HeldStorageRow[],
  admission: StorageAdmission,
) {
  const planned = new Map(
    [...scan.files].map(([key, files]) => [
      key,
      new Set(files.map((f) => path.basename(f.file))),
    ]),
  );
  const counts = { imports: 0, validation: 0, blobs: 0 };
  for (const key of planned.keys())
    counts[key.split(":")[0] as keyof typeof counts]++;
  let entries = scan.entries;
  const fail = () => {
    throw new StudioError(
      admission.namespace === "validation"
        ? "VALIDATION_SCAN_LIMIT"
        : "RECEIVE_SCAN_LIMIT",
    );
  };
  const reserve = (
    namespace: "imports" | "validation",
    id: string,
    added: number,
  ) => {
    const key = storageScanKey(namespace, id);
    if (!planned.has(key)) {
      planned.set(key, new Set());
      counts[namespace]++;
      entries++;
    }
    const names = planned.get(key)!;
    if (
      counts[namespace] > storageNamespaceLimits[namespace] ||
      names.size + added > MAX_FILES_PER_IMPORT ||
      entries + added > MAX_SCAN_ENTRIES
    )
      fail();
    entries += added;
    // Reserved slots are deliberately unnamed and cannot be reused by a different attempt.
    for (let i = 0; i < added; i++) names.add(`reserved-slot-${names.size}`);
  };
  const futureBlobs = new Set<string>();
  let unknownBlobSlots = 0;
  const reserveBlobPlan = (hashes: readonly string[] | null) => {
    if (hashes === null) {
      unknownBlobSlots += 64;
      return;
    }
    if (
      hashes.length > 64 ||
      hashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash))
    )
      throw new StudioError("RECEIVE_STORAGE_CONFLICT");
    for (const hash of hashes)
      if (!scan.files.has(storageScanKey("blobs", hash))) futureBlobs.add(hash);
  };
  const seen = new Set<StorageScanKey>();
  for (const row of rows) {
    const key = storageScanKey(row.namespace, row.id);
    if (seen.has(key)) throw new StudioError("RECEIVE_STORAGE_CONFLICT");
    seen.add(key);
    const held = heldAttempts(row);
    if (!held.length) continue;
    const names = [...(planned.get(key) ?? [])];
    let added =
      row.namespace === "imports" && !names.includes("archive.quizpack")
        ? 1
        : 0;
    for (const attempt of held) {
      if (!names.includes(`attempt-${attempt.attemptId}.partial`)) added++;
      if (!names.includes(`stopped-${attempt.attemptId}.json`)) added++;
      if (
        !names.some((name) =>
          name.startsWith(`stopped-${attempt.attemptId}.json.tmp-`),
        )
      )
        added++;
      if (row.namespace === "validation") reserveBlobPlan(row.assetBlobHashes);
    }
    reserve(row.namespace, row.id, added);
  }
  const current = planned.get(
    storageScanKey(admission.namespace, admission.id),
  );
  reserve(
    admission.namespace,
    admission.id,
    3 +
      (admission.namespace === "imports" && !current?.has("archive.quizpack")
        ? 1
        : 0),
  );
  if (admission.namespace === "validation")
    reserveBlobPlan(admission.assetBlobHashes);
  const newBlobNames = futureBlobs.size + unknownBlobSlots;
  if (
    counts.blobs + newBlobNames > storageNamespaceLimits.blobs ||
    entries + newBlobNames > MAX_SCAN_ENTRIES
  )
    fail();
}
export function requireReceiveCapacity(
  scan: Scan,
  id: string,
  rows: ImportRow[] = [],
) {
  requireStorageCapacity(scan, importHeldStorageRows(rows), {
    namespace: "imports",
    id,
    assetBlobHashes: null,
  });
}
