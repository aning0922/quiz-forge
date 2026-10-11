import "server-only";
import type postgres from "postgres";

// Shared by all auth write transactions and management disable. Always acquire before row locks.
export async function acquireAuthWriteLock(
  tx: postgres.TransactionSql,
): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(72461,1)`;
}
