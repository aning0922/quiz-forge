import "server-only";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { P2aDatabase } from "@/lib/db/client";
import { acquireAuthWriteLock } from "@/lib/db/auth-lock";
import {
  csrfForToken,
  digestToken,
  issueToken,
  verifyCsrf,
} from "@/lib/security/p2a-tokens";
import { StudioError, type StudioErrorCode } from "@/lib/http-security/errors";
import type {
  StudioPreauthDto,
  StudioSessionDto,
} from "@/features/studio/contracts";
import { requireCapability, type StudioActor } from "./capabilities";

import {
  activeActor,
  toActor,
  dateFromDatabase,
  type ActorRow,
  type DatabaseTime,
} from "./internal";
type Transaction = postgres.TransactionSql;
type Result<T> = { ok: true; value: T } | { ok: false; code: StudioErrorCode };
function result<T>(value: Result<T>): T {
  if (!value.ok) throw new StudioError(value.code);
  return value.value;
}

function assertCsrf(
  raw: string | null,
  kind: "preauth" | "session",
  csrf: string | null,
): asserts raw is string {
  if (!raw || !csrf || !verifyCsrf(raw, kind, csrf))
    throw new StudioError("CSRF_REJECTED");
}

async function audit(
  tx: Transaction,
  action: "preauth_created" | "login_succeeded" | "login_failed" | "logout",
  requestId: string,
  sessionId: string,
  actorId: string | null,
  rejected = false,
): Promise<void> {
  await tx`INSERT INTO qf.audit_event (id, occurred_at, action, outcome, reason_code, actor_id, session_id, request_id)
    VALUES (${randomUUID()}, clock_timestamp(), ${action}, ${rejected ? "rejected" : "success"}, ${rejected ? "AUTHENTICATION_FAILED" : null}, ${actorId}, ${sessionId}, ${requestId})`;
}

export function sessionDto(actor: StudioActor, raw: string): StudioSessionDto {
  requireCapability(actor, "studio:read");
  const csrfToken = csrfForToken(raw, "session");
  if (!csrfToken) throw new StudioError("UNAUTHENTICATED");
  return {
    operator: {
      id: actor.id,
      role: actor.role,
      loginName: actor.loginName,
      displayName: actor.displayName,
      accountRevision: actor.accountRevision,
    },
    csrfToken,
    idleExpiresAt: actor.idleExpiresAt.toISOString(),
    absoluteExpiresAt: actor.absoluteExpiresAt.toISOString(),
  };
}

/** DB row authority, including a conditional touch that cannot revive a revoked session. */
export async function readSession(
  database: P2aDatabase,
  raw: string | null,
): Promise<StudioActor> {
  const digest = raw ? digestToken(raw, "session") : null;
  if (!digest) throw new StudioError("UNAUTHENTICATED");
  const actor = await database.sql.begin(async (tx) => {
    await acquireAuthWriteLock(tx);
    const row = await activeActor(tx, digest);
    if (!row) return null;
    const [touched] = await tx<ActorRow[]>`
      WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS at)
      UPDATE qf.operator_session s SET last_seen_at = moment.at,
        idle_expires_at = LEAST(moment.at + interval '30 minutes', s.absolute_expires_at)
      FROM moment, qf.operator o WHERE s.id = ${row.session_id} AND s.kind = 'authenticated'
        AND s.revoked_at IS NULL AND s.idle_expires_at > moment.at AND s.absolute_expires_at > moment.at
        AND o.id = s.operator_id AND o.status = 'active'
      RETURNING o.id, o.role,o.login_name,o.display_name,o.account_revision, s.id AS session_id, s.idle_expires_at, s.absolute_expires_at`;
    const current = touched ? await activeActor(tx, digest) : null;
    return current ? toActor(current) : null;
  });
  if (!actor) throw new StudioError("UNAUTHENTICATED");
  return actor;
}

export async function createPreauth(
  database: P2aDatabase,
  currentRaw: string | null,
  requestId: string,
): Promise<{ raw: string; dto: StudioPreauthDto }> {
  return result(
    await database.sql.begin(async (tx) => {
      await acquireAuthWriteLock(tx);
      const currentDigest = currentRaw
        ? digestToken(currentRaw, "session")
        : null;
      if (currentDigest && (await activeActor(tx, currentDigest)))
        return { ok: false, code: "ALREADY_AUTHENTICATED" } as const;
      const [counts] = await tx<{ recent: number; outstanding: number }[]>`
      SELECT (SELECT count(*)::int FROM qf.audit_event WHERE action = 'preauth_created'
        AND outcome = 'success' AND occurred_at > clock_timestamp() - interval '60 seconds') AS recent,
        (SELECT count(*)::int FROM qf.operator_session WHERE kind = 'preauth' AND revoked_at IS NULL
        AND idle_expires_at > clock_timestamp() AND absolute_expires_at > clock_timestamp()) AS outstanding`;
      if (!counts || counts.recent >= 20 || counts.outstanding >= 100)
        return { ok: false, code: "RATE_LIMITED" } as const;
      const token = issueToken("preauth");
      const sessionId = randomUUID();
      const [session] = await tx<{ absolute_expires_at: DatabaseTime }[]>`
      WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS at)
      INSERT INTO qf.operator_session (id, token_digest, kind, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
      SELECT ${sessionId}, ${token.digest}, 'preauth', at, at, at + interval '5 minutes', at + interval '5 minutes' FROM moment
      RETURNING absolute_expires_at`;
      if (!session) throw new StudioError("STUDIO_UNAVAILABLE");
      await audit(tx, "preauth_created", requestId, sessionId, null);
      return {
        ok: true,
        value: {
          raw: token.raw,
          dto: {
            csrfToken: csrfForToken(token.raw, "preauth")!,
            expiresAt: dateFromDatabase(
              session.absolute_expires_at,
            ).toISOString(),
          },
        },
      } as const;
    }),
  );
}

export async function logout(
  database: P2aDatabase,
  raw: string | null,
  csrf: string | null,
  requestId: string,
): Promise<void> {
  assertCsrf(raw, "session", csrf);
  const digest = digestToken(raw, "session")!;
  const revoked = await database.sql.begin(async (tx) => {
    await acquireAuthWriteLock(tx);
    const row = await activeActor(tx, digest);
    if (!row) return false;
    requireCapability(toActor(row), "studio:read");
    const [session] = await tx<
      { id: string }[]
    >`UPDATE qf.operator_session s SET revoked_at = clock_timestamp()
      WHERE s.id = ${row.session_id} AND s.revoked_at IS NULL
        AND s.idle_expires_at > clock_timestamp() AND s.absolute_expires_at > clock_timestamp()
        AND EXISTS (SELECT 1 FROM qf.operator o WHERE o.id = s.operator_id AND o.status = 'active') RETURNING s.id`;
    if (!session) return false;
    await audit(tx, "logout", requestId, row.session_id, row.id);
    return true;
  });
  if (!revoked) throw new StudioError("UNAUTHENTICATED");
}
