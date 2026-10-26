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
  role: StudioRole;
  login_name: string;
  display_name: string;
  account_revision: number;
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
  // The narrow SD read checks password readiness without granting app PHC access.
  const [row] = await tx<
    ActorRow[]
  >`SELECT o.id, o.role, o.login_name,o.display_name,o.account_revision, s.id AS session_id,
    s.idle_expires_at, s.absolute_expires_at
    FROM qf.account_actor(${digest}) s JOIN qf.operator o ON o.id = s.operator_id`;
  return row ?? null;
}

export function toActor(row: ActorRow): StudioActor {
  const actor = verifiedActor({
    id: row.id,
    role: row.role,
    loginName: row.login_name,
    displayName: row.display_name,
    accountRevision: row.account_revision,
    sessionId: row.session_id,
    idleExpiresAt: dateFromDatabase(row.idle_expires_at),
    absoluteExpiresAt: dateFromDatabase(row.absolute_expires_at),
  });
  requireCapability(actor, "studio:read");
  return actor;
}
