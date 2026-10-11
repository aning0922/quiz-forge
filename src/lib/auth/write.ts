import "server-only";
import type postgres from "postgres";
import type { P2aDatabase } from "@/lib/db/client";
import { acquireAuthWriteLock } from "@/lib/db/auth-lock";
import { digestToken, verifyCsrf } from "@/lib/security/p2a-tokens";
import { StudioError } from "@/lib/http-security/errors";
import {
  requireCapability,
  type StudioActor,
  type StudioCapability,
} from "./capabilities";
import { activeActor, toActor } from "./internal";

export type StudioWriteCredentials = Readonly<{
  sessionToken: string | null;
  csrfToken: string | null;
  requestId: string;
}>;

/** One transaction; the driver propagates callback errors only after successful ROLLBACK. */
export async function withStudioWrite<T>(
  database: P2aDatabase,
  credentials: StudioWriteCredentials,
  capability: StudioCapability,
  work: (tx: postgres.TransactionSql, actor: StudioActor) => Promise<T>,
): Promise<T> {
  const digest = credentials.sessionToken
    ? digestToken(credentials.sessionToken, "session")
    : null;
  if (!digest) throw new StudioError("UNAUTHENTICATED");
  if (
    !credentials.csrfToken ||
    !verifyCsrf(credentials.sessionToken!, "session", credentials.csrfToken)
  )
    throw new StudioError("CSRF_REJECTED");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      credentials.requestId,
    )
  )
    throw new StudioError("INVALID_REQUEST");
  let readyToCommit = false;
  try {
    return (await database.sql.begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '2s'`;
      await tx`SET LOCAL statement_timeout = '5s'`;
      await tx`SET LOCAL transaction_timeout = '10s'`;
      await acquireAuthWriteLock(tx);
      const row = await activeActor(tx, digest);
      if (!row) throw new StudioError("UNAUTHENTICATED");
      const actor = toActor(row);
      requireCapability(actor, capability);
      const value = await work(tx, actor);
      const current = await activeActor(tx, digest);
      if (!current) throw new StudioError("UNAUTHENTICATED");
      requireCapability(toActor(current), capability);
      const touched = await tx`
        WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS at)
        UPDATE qf.operator_session s SET last_seen_at = moment.at,
          idle_expires_at = LEAST(moment.at + interval '30 minutes', s.absolute_expires_at)
        FROM moment, qf.operator o WHERE s.id = ${actor.sessionId} AND s.kind = 'authenticated'
          AND s.revoked_at IS NULL AND s.idle_expires_at > moment.at AND s.absolute_expires_at > moment.at
          AND o.id = s.operator_id AND o.status = 'active' AND o.role = ${current.role}
        RETURNING s.id`;
      if (!touched.length) throw new StudioError("UNAUTHENTICATED");
      readyToCommit = true;
      return value;
    })) as T;
  } catch (error) {
    if (readyToCommit) throw new StudioError("WRITE_OUTCOME_UNKNOWN");
    if (error instanceof StudioError) throw error;
    const fault = error as { code?: string; constraint_name?: string };
    if (fault.code === "55P03" || fault.code === "57014")
      throw new StudioError("WRITE_BUSY");
    if (fault.code === "23505") {
      if (fault.constraint_name === "product_pkey")
        throw new StudioError("PRODUCT_ID_CONFLICT");
      if (
        ["product_slug_key", "category_slug_key", "tag_slug_key"].includes(
          fault.constraint_name ?? "",
        )
      )
        throw new StudioError("SLUG_CONFLICT");
    }
    // Connection loss / transaction-timeout termination cannot prove rollback or commit.
    throw new StudioError("WRITE_OUTCOME_UNKNOWN");
  }
}
