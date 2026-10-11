import "server-only";
import path from "node:path";
import { StudioError } from "@/lib/http-security/errors";
import type { ImportRow } from "./repository";
import type { Scan } from "./storage";
import { UPLOAD_QUOTA_BYTES } from "./limits";
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
