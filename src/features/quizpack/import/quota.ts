import "server-only";
import path from "node:path";
import { StudioError } from "@/lib/http-security/errors";
import type { ImportRow } from "./repository";
import type { Scan } from "./storage";
import {
  UPLOAD_QUOTA_BYTES,
  MAX_IMPORT_DIRECTORIES,
  MAX_FILES_PER_IMPORT,
  MAX_SCAN_ENTRIES,
} from "./limits";
/** Double names count twice. Only a known attempt's own partial offsets its headroom. */
export function measuredQuota(scan: Scan, rows: ImportRow[]): number {
  let bytes = scan.bytes;
  for (const row of rows) {
    const held = row.attempts.filter((a) => a.disposition === "held");
    if (
      held.reduce((n, a) => n + a.reservationBytes, 0) !==
      Number(row.reserved_bytes)
    )
      throw new StudioError("RECEIVE_STORAGE_CONFLICT");
    for (const a of held) {
      const owned = (scan.files.get(row.id) ?? [])
        .filter(
          (f) => path.basename(f.file) === `attempt-${a.attemptId}.partial`,
        )
        .reduce((n, f) => n + f.size, 0);
      bytes += Math.max(0, a.reservationBytes - owned);
    }
  }
  return bytes;
}
export function requireQuota(bytes: number, added = 0) {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes + added > UPLOAD_QUOTA_BYTES
  )
    throw new StudioError("RECEIVE_QUOTA_EXCEEDED");
}

/** Reserve shape for every new name before claim; do not create an unscannable namespace. */
export function requireReceiveCapacity(
  scan: Scan,
  id: string,
  rows: ImportRow[] = [],
) {
  const planned = new Map(
    [...scan.files].map(([key, files]) => [key, files.length]),
  );
  let entries = scan.entries;
  const reserve = (key: string, added: number) => {
    if (!planned.has(key)) {
      planned.set(key, 0);
      entries++;
    }
    planned.set(key, planned.get(key)! + added);
    if (
      planned.size > MAX_IMPORT_DIRECTORIES ||
      planned.get(key)! > MAX_FILES_PER_IMPORT ||
      entries + added > MAX_SCAN_ENTRIES
    )
      throw new StudioError("RECEIVE_SCAN_LIMIT");
    entries += added;
  };
  // A lost owner can still finish previously-issued mkdir/write/link. Held reservations survive
  // absent files, lock loss and stopped proof until the reconciliation transaction confirms release.
  for (const row of rows) {
    const held = row.attempts.filter((a) => a.disposition === "held");
    if (
      held.reduce((n, a) => n + a.reservationBytes, 0) !==
      Number(row.reserved_bytes)
    )
      throw new StudioError("RECEIVE_STORAGE_CONFLICT");
    if (!held.length) continue;
    const names = (scan.files.get(row.id) ?? []).map((f) =>
      path.basename(f.file),
    );
    let added = names.includes("archive.quizpack") ? 0 : 1;
    for (const a of held) {
      if (!names.includes(`attempt-${a.attemptId}.partial`)) added++;
      if (!names.includes(`stopped-${a.attemptId}.json`)) added++;
      if (
        !names.some((name) =>
          name.startsWith(`stopped-${a.attemptId}.json.tmp-`),
        )
      )
        added++;
    }
    reserve(row.id, added);
  }
  const current = scan.files.get(id);
  reserve(
    id,
    3 +
      (current?.some((f) => path.basename(f.file) === "archive.quizpack")
        ? 0
        : 1),
  );
}
