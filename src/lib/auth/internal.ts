import "server-only";
import type postgres from "postgres";
import { StudioError } from "@/lib/http-security/errors";
import {
  verifiedActor,
  requireCapability,
  type StudioActor,
  type StudioRole,
} from "./capabilities";
type Transaction = postgres.TransactionSql;
export type DatabaseTime = string | Date;
export type ActorRow = {
  id: string;
  label: string;
  role: StudioRole;
  login_name?: string | null;
  display_name?: string | null;
  account_revision?: number;
  session_id: string;
  idle_expires_at: DatabaseTime;
  absolute_expires_at: DatabaseTime;
};

// Drizzle intentionally installs transparent timestamp parsers on its postgres.js client.
// Raw SQL on that shared client therefore returns text; Drizzle schema Date types apply to db.
export function dateFromDatabase(value: DatabaseTime): Date {
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new StudioError("STUDIO_UNAVAILABLE");
  return date;
}

export async function activeActor(
  tx: Transaction,
  digest: string,
): Promise<ActorRow | null> {
  // App has SELECT-only operator privileges. Mutation statements recheck active.
  const [row] = await tx<
    ActorRow[]
  >`SELECT o.id, o.label, o.role, o.login_name,o.display_name,o.account_revision, s.id AS session_id,
    s.idle_expires_at, s.absolute_expires_at
    FROM qf.operator_session s JOIN qf.operator o ON o.id = s.operator_id
    WHERE s.token_digest = ${digest} AND s.kind = 'authenticated'
      AND s.revoked_at IS NULL AND s.idle_expires_at > clock_timestamp()
      AND s.absolute_expires_at > clock_timestamp() AND o.status = 'active'`;
  return row ?? null;
}

export function toActor(row: ActorRow): StudioActor {
  const actor = verifiedActor({
    id: row.id,
    label: row.label,
    role: row.role,
    loginName: row.login_name ?? null,
    displayName: row.display_name ?? row.label,
    accountRevision: row.account_revision ?? 1,
    sessionId: row.session_id,
    idleExpiresAt: dateFromDatabase(row.idle_expires_at),
    absoluteExpiresAt: dateFromDatabase(row.absolute_expires_at),
  });
  requireCapability(actor, "studio:read");
  return actor;
}
