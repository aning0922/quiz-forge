import "server-only";
import type postgres from "postgres";
import type { RecoveryBudget, RecoveryAuthenticationRevocation } from "./ports";
import { checkRecoveryBudget } from "./files";
import { RecoveryError } from "./errors";

/** Only a new, pending, isolated restore target may call this after source equality was proven. */
export async function invalidateRestoredStudioAuthority(
  sql: postgres.ReservedSql,
  budget: RecoveryBudget,
): Promise<RecoveryAuthenticationRevocation> {
  checkRecoveryBudget(budget);
  await sql.unsafe("BEGIN");
  await sql.unsafe("SET LOCAL lock_timeout='2s'");
  await sql.unsafe("SET LOCAL statement_timeout='2s'");
  // Same first lock as authentication, account writes and operator maintenance.
  await sql`SELECT pg_advisory_xact_lock(72461,1)`;
  const accounts = await sql`
    UPDATE qf.operator SET account_revision=account_revision+1`;
  const sessions = await sql`
    UPDATE qf.operator_session SET revoked_at=clock_timestamp()
    WHERE revoked_at IS NULL`;
  const tokens = await sql`
    UPDATE qf.operator_password_token SET revoked_at=clock_timestamp()
    WHERE revoked_at IS NULL AND consumed_at IS NULL`;
  const [remaining] = await sql<{ sessions: number; tokens: number }[]>`
    SELECT
      (SELECT count(*)::int FROM qf.operator_session WHERE revoked_at IS NULL) sessions,
      (SELECT count(*)::int FROM qf.operator_password_token
        WHERE revoked_at IS NULL AND consumed_at IS NULL) tokens`;
  if (remaining?.sessions !== 0 || remaining.tokens !== 0)
    throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
  checkRecoveryBudget(budget);
  // No retry: a failed/unknown COMMIT leaves the caller's recovery-pending guard intact.
  await sql.unsafe("COMMIT");
  return {
    accounts: accounts.count,
    sessions: sessions.count,
    passwordTokens: tokens.count,
  };
}
