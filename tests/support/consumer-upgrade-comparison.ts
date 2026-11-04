import assert from "node:assert/strict";
import type postgres from "postgres";

type Row = Record<string, unknown>;
type Table = "access_key" | "consumer_session" | "quiz_report";
const timestampColumns = [
  "created_at",
  "issued_at",
  "expires_at",
  "revoked_at",
  "completed_at",
] as const;
const addedSessionColumns = [
  "activation_generation",
  "issued_play_version_id",
  "issued_play_snapshot_sha256",
  "key_bound_play_version_id",
  "key_bound_play_snapshot_sha256",
  "activation_ref_generation",
] as const;
const serialized = (value: unknown): Row => JSON.parse(JSON.stringify(value));

/** Compare timestamptz in PostgreSQL, retaining full database precision and NULL
 * semantics. Every other original field, including canonical TEXT, stays exact.
 * Only the explicitly added session columns are excluded from the old projection.
 */
export async function readConsumerUpgradeComparison(
  sql: postgres.Sql | postgres.TransactionSql,
  table: Table,
  before: Row,
) {
  assert(["access_key", "consumer_session", "quiz_report"].includes(table));
  assert.equal(typeof before.id, "string");
  const [after] = await sql.unsafe<Row[]>(
    `SELECT * FROM qf.${table} WHERE id=$1`,
    [before.id as string],
  );
  assert(after, "Original upgrade row is missing");
  const times = timestampColumns.filter((name) => Object.hasOwn(before, name));
  assert(times.length > 0);
  const [timeEquality] = await sql.unsafe<Record<string, boolean>[]>(
    `SELECT ${times.map((name, i) => `${name} IS NOT DISTINCT FROM $${i + 2}::timestamptz AS ${name}`).join(",")} FROM qf.${table} WHERE id=$1`,
    [
      before.id as string,
      ...times.map((name) => before[name] as string | null),
    ],
  );
  assert(timeEquality);
  const [databaseText] = await sql.unsafe<{ body: Row }[]>(
    `SELECT to_jsonb(t) AS body FROM qf.${table} t WHERE id=$1`,
    [before.id as string],
  );
  assert(databaseText);
  const originalFieldsBefore = serialized(before);
  const originalFieldsAfter = serialized(after);
  for (const name of times) {
    delete originalFieldsBefore[name];
    delete originalFieldsAfter[name];
  }
  if (table === "consumer_session")
    for (const name of addedSessionColumns) delete originalFieldsAfter[name];
  return {
    table,
    before: serialized(before),
    afterDriverSerialized: serialized(after),
    afterDatabaseText: databaseText.body,
    timeEquality,
    originalFieldsBefore,
    originalFieldsAfter,
  };
}

export function assertConsumerUpgradeUnchanged(
  comparison: Awaited<ReturnType<typeof readConsumerUpgradeComparison>>,
) {
  for (const [column, equal] of Object.entries(comparison.timeEquality))
    assert.equal(equal, true, `${comparison.table}.${column} changed`);
  assert.deepEqual(
    comparison.originalFieldsAfter,
    comparison.originalFieldsBefore,
  );
}
