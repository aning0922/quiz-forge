import "server-only";
import type postgres from "postgres";
import { StudioError } from "@/lib/http-security/errors";
/** Never wait while holding auth/Product locks. The transaction retains this through commit. */
export async function acquireReferenceWriteLock(
  tx: postgres.TransactionSql,
): Promise<void> {
  const [row] = await tx<
    { locked: boolean }[]
  >`SELECT pg_try_advisory_xact_lock_shared(72461,2) AS locked`;
  if (row?.locked !== true) throw new StudioError("WRITE_BUSY");
}
