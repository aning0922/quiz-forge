import "server-only";
import type postgres from "postgres";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { P2aDatabase } from "@/lib/db/client";
import { activeActor, toActor } from "@/lib/auth/internal";
import { requireCapability, type StudioActor } from "@/lib/auth/capabilities";
import { digestToken, verifyCsrf } from "@/lib/security/p2a-tokens";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import { StudioError } from "@/lib/http-security/errors";
import {
  iso,
  nullableIso,
  productRow,
  type Tx,
} from "@/features/product/workspace/repository";
import type {
  ImportDto,
  ImportStatus,
  StorageCondition,
  ReceiveErrorCode,
} from "./contracts";
import { attemptSchema, type Attempt } from "./storage";
import type { DatabaseTime } from "@/lib/auth/internal";
import { MAX_REVISION } from "./limits";
export type ImportRow = {
  id: string;
  product_id: string;
  created_by: string;
  idempotency_key: string;
  request_fingerprint: string;
  expected_archive_sha256: string;
  expected_archive_bytes: number;
  status: ImportStatus;
  state_revision: number;
  updated_at: DatabaseTime;
  created_at: DatabaseTime;
  received_at: DatabaseTime | null;
  storage_condition: StorageCondition;
  last_error_code: ReceiveErrorCode | null;
  fence: number;
  lease_until: DatabaseTime | null;
  current_attempt_id: string | null;
  attempts: Attempt[];
  actual_archive_sha256: string | null;
  actual_archive_bytes: number | null;
  archive_storage_key: string | null;
  reserved_bytes: string;
  accounted_bytes: string;
};
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new StudioError("INVALID_REQUEST");
  return r.data;
}
export function canIncrement(row: ImportRow, fence = false) {
  if (
    row.state_revision >= MAX_REVISION ||
    (fence && row.fence >= MAX_REVISION)
  )
    throw new StudioError("REVISION_LIMIT");
}
export function dto(row: ImportRow): ImportDto {
  return {
    id: row.id,
    productId: row.product_id,
    status: row.status,
    stateRevision: row.state_revision,
    expectedArchiveSha256: row.expected_archive_sha256,
    expectedArchiveBytes: row.expected_archive_bytes,
    actualArchiveSha256: row.actual_archive_sha256,
    actualArchiveBytes: row.actual_archive_bytes,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    receivedAt: nullableIso(row.received_at),
    storageCondition: row.storage_condition,
    lastErrorCode: row.last_error_code,
    validationStatus: "not-run",
    publishable: false,
  };
}
export async function importRow(
  tx: Tx,
  productId: string,
  id: string,
  lock = false,
) {
  const [row] = await tx<
    ImportRow[]
  >`SELECT * FROM qf.quizpack_import WHERE product_id=${productId} AND id=${id} ${lock ? tx`FOR UPDATE` : tx``}`;
  if (!row) throw new StudioError("IMPORT_NOT_FOUND");
  if (!z.array(attemptSchema).max(3).safeParse(row.attempts).success)
    throw new StudioError("RECEIVE_STORAGE_CONFLICT");
  return row;
}
export async function activeProduct(tx: Tx, id: string) {
  const row = await productRow(tx, id, true);
  if (row.archived_at !== null) throw new StudioError("PRODUCT_ARCHIVED");
  return row;
}
export async function read<T>(
  db: P2aDatabase,
  token: string | null,
  work: (tx: Tx, actor: StudioActor) => Promise<T>,
  writeCredentials?: StudioWriteCredentials,
) {
  const digest = token ? digestToken(token, "session") : null;
  if (!digest) throw new StudioError("UNAUTHENTICATED");
  if (
    writeCredentials &&
    (!writeCredentials.csrfToken ||
      !verifyCsrf(token!, "session", writeCredentials.csrfToken))
  )
    throw new StudioError("CSRF_REJECTED");
  try {
    return (await db.sql.begin(
      "isolation level repeatable read read only",
      async (tx) => {
        await tx`SET LOCAL statement_timeout='5s'`;
        await tx`SET LOCAL transaction_timeout='10s'`;
        const current = await activeActor(tx, digest);
        if (!current) throw new StudioError("UNAUTHENTICATED");
        const actor = toActor(current);
        requireCapability(
          actor,
          writeCredentials ? "import:create" : "studio:read",
        );
        return work(tx, actor);
      },
    )) as T;
  } catch (e) {
    if (e instanceof StudioError) throw e;
    throw new StudioError("STUDIO_UNAVAILABLE");
  }
}
export async function audit(
  tx: Tx,
  actor: StudioActor,
  credentials: StudioWriteCredentials,
  row: ImportRow,
  action:
    | "intent_created"
    | "receive_started"
    | "receive_completed"
    | "receive_failed"
    | "receive_recovered",
) {
  await tx`INSERT INTO qf.audit_event(id,occurred_at,action,outcome,actor_id,session_id,request_id,target_kind,target_id,target_revision) VALUES(${randomUUID()},clock_timestamp(),${`import_${action}`},'success',${actor.id},${actor.sessionId},${credentials.requestId},'import',${row.id},${row.state_revision})`;
}
export async function heldRows(
  sql: postgres.Sql | postgres.ReservedSql,
): Promise<ImportRow[]> {
  const rows = await sql<
    ImportRow[]
  >`SELECT * FROM qf.quizpack_import WHERE reserved_bytes>0 ORDER BY id LIMIT 1025`;
  if (rows.length > 1024) throw new StudioError("RECEIVE_SCAN_LIMIT");
  for (const row of rows)
    if (!z.array(attemptSchema).max(3).safeParse(row.attempts).success)
      throw new StudioError("RECEIVE_STORAGE_CONFLICT");
  return rows;
}
