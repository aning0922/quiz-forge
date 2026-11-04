/** Bounded one-shot upgrade check against an explicitly prepared NEW managed test
 * instance. The baseline is synthetic p4Fixture data from schema 0029. It is
 * retained on failure; this harness never resets, cleans up, or replays a run. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type postgres from "postgres";
import { openManagedDatabase } from "../../src/lib/db/management";
import { openSql } from "../../src/lib/db/client";
import { migrateDatabase, readMigrations } from "../../src/lib/db/migrate";
import { CONSUMER_CATALOG_QUERY } from "../../src/lib/db/consumer-catalog";
import { consumerCanonicalText } from "../../src/lib/consumer-contract/v1/integrity";
import {
  consumerProductActivationBindingText,
  verifyConsumerProductActivationReceipt,
} from "../../src/features/product/internal-play/activation-contracts";
import {
  readConsumerUpgradeComparison,
  assertConsumerUpgradeUnchanged,
} from "../support/consumer-upgrade-comparison";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
type Row = Record<string, unknown>;
const baselineFile = path.resolve(process.argv[2] ?? "");
assert(baselineFile.startsWith(process.cwd() + "/.cache/"));
const baseline = JSON.parse(await readFile(baselineFile, "utf8"));
assert.equal(baseline.root, process.cwd());
assert.match(baseline.instanceId, /^[a-f0-9]{32}$/);
const directory = path.dirname(baselineFile);
await writeFile(
  path.join(directory, "latest-policy-check.intent.json"),
  JSON.stringify({
    instanceId: baseline.instanceId,
    root: process.cwd(),
    baselineSha256: hash(await readFile(baselineFile, "utf8")),
    scope:
      "new isolated DB-only upgrade and guards; no runtime readiness or production activation",
  }),
  { flag: "wx", mode: 0o600 },
);
const managed = await openManagedDatabase(baseline.instanceId);
assert.equal(managed.config.purpose, "test");
let app: postgres.Sql | undefined;
const checks: string[] = [];
const pass = (s: string) => checks.push(s);
const normalized = (v: unknown) => JSON.parse(JSON.stringify(v));
async function rejected(
  work: (tx: postgres.TransactionSql) => Promise<unknown>,
  expected: string,
  sql = managed.sql,
  expectedMessage?: string,
) {
  let caught: string | undefined;
  let message: string | undefined;
  try {
    await sql.begin(async (tx) => {
      await work(tx);
      throw Error("COUNTEREXAMPLE_ACCEPTED");
    });
  } catch (e) {
    caught = (e as { code?: string }).code;
    message = (e as Error).message;
    if (!caught) throw e;
  }
  assert.equal(caught, expected);
  if (expectedMessage !== undefined) assert.equal(message, expectedMessage);
}
async function oldGraphUnchanged() {
  for (const [table, original] of [
    ["access_key", baseline.incompleteKey],
    ["access_key", baseline.completedKey],
    ["consumer_session", baseline.incomplete],
    ["consumer_session", baseline.completed],
    ["quiz_report", baseline.report],
  ] as const) {
    assertConsumerUpgradeUnchanged(
      await readConsumerUpgradeComparison(managed.sql, table, original),
    );
  }
}
async function activate(expectedGeneration: number, play = baseline.playRef) {
  const id = randomUUID();
  const binding = {
    schemaVersion: "quizforge.consumer-product-activate.v1",
    productId: play.productId,
    operationKey: randomUUID(),
    expectedGeneration,
    playVersionId: play.playVersionId,
    playSnapshotSha256: play.playSnapshotSha256,
  };
  const text = consumerProductActivationBindingText(binding);
  const [row] = await managed.sql<
    Row[]
  >`INSERT INTO qf.consumer_product_activation(id,product_id,operation_key,expected_generation,generation,play_version_id,play_snapshot_sha256,binding_text,binding_sha256,activated_by,operator_session_id,request_id,activated_at,receipt_text,receipt_sha256)
    VALUES(${id},${play.productId},${binding.operationKey},${expectedGeneration},${expectedGeneration + 1},${play.playVersionId},${play.playSnapshotSha256},${text},${hash(text)},${baseline.actorId},${baseline.operatorSessionId},${randomUUID()},clock_timestamp(),'','') RETURNING *`;
  assert(row);
  const receipt = await verifyConsumerProductActivationReceipt(
    JSON.parse(String(row.receipt_text)),
  );
  assert.equal(hash(String(row.receipt_text)), row.receipt_sha256);
  assert.equal(receipt.bindingSha256, hash(text));
  return row;
}
function sessionRow(generation: number, play = baseline.playRef) {
  const result: Row = {
    ...baseline.incomplete,
    id: randomUUID(),
    activation_generation: generation,
    issued_play_version_id: baseline.playRef.playVersionId,
    issued_play_snapshot_sha256: baseline.playRef.playSnapshotSha256,
    play_version_id: play.playVersionId,
    play_snapshot_sha256: play.playSnapshotSha256,
  };
  return result;
}
async function insertSession(
  sql: postgres.Sql | postgres.TransactionSql,
  row: Row,
) {
  const [result] = await sql<
    Row[]
  >`INSERT INTO qf.consumer_session ${sql(row)} RETURNING *`;
  assert(result);
  return result;
}
async function historicalGrant(sql: postgres.Sql | postgres.TransactionSql) {
  return sql`INSERT INTO qf.consumer_grant(key_id,slot,session_id,grant_id,credential_digest,issued_at,expires_at)
   VALUES(${baseline.completedKey.id},1,${baseline.completed.id},${randomUUID()},${hash(randomUUID())},clock_timestamp(),clock_timestamp())`;
}
try {
  const historyBefore = normalized(
    await managed.sql`SELECT version,checksum,applied_at FROM qf_meta.schema_migrations ORDER BY version`,
  );
  assert.deepEqual(historyBefore, baseline.history);
  const applied = await migrateDatabase(
    managed.sql,
    managed.config,
    await readMigrations(),
  );
  assert.equal(
    applied.length,
    1,
    "Exactly formal 0030 from an untouched prepared schema-0029 baseline required",
  );
  assert.equal(applied[0], "0030_consumer_latest_attempts");
  await oldGraphUnchanged();
  pass(
    "old issue/session/report columns and report snapshot unchanged through upgrade",
  );
  const [heads] = await managed.sql<
    { count: number }[]
  >`SELECT count(*)::integer count FROM qf.consumer_product_head`;
  assert.equal(heads!.count, 0);
  pass("no implicit/default head");
  app = openSql(managed.config.database);
  await historicalGrant(app);
  pass("completed historical grant before any head exists");
  // Construct a genuinely expired synthetic key inside a rollback-only fixture.
  // Re-enable its original immutable trigger BEFORE exercising the real grant guard.
  try {
    await managed.sql.begin(async (tx) => {
      await tx`ALTER TABLE qf.access_key DISABLE TRIGGER consumer_key_change`;
      await tx`WITH moment AS MATERIALIZED(SELECT date_trunc('milliseconds',clock_timestamp()) at) UPDATE qf.access_key SET expires_at=m.at-interval '1 second',issued_at=m.at-interval '1 second'-valid_for_seconds*interval '1 second' FROM moment m WHERE id=${baseline.completedKey.id}`;
      await tx`ALTER TABLE qf.access_key ENABLE TRIGGER consumer_key_change`;
      await tx`DELETE FROM qf.consumer_grant WHERE key_id=${baseline.completedKey.id}`;
      await historicalGrant(tx);
      throw Error("EXPECTED_EXPIRED_FIXTURE_ROLLBACK");
    });
  } catch (e) {
    assert.equal((e as Error).message, "EXPECTED_EXPIRED_FIXTURE_ROLLBACK");
  }
  await oldGraphUnchanged();
  pass(
    "expired completed key still grants original report without a head; fixture rolled back",
  );
  await rejected(
    (tx) => insertSession(tx, sessionRow(0)),
    "23514",
    app,
    "VERSION_SUPERSEDED",
  );
  await rejected(
    (tx) =>
      tx`UPDATE qf.consumer_session SET state_revision=state_revision+1 WHERE id=${baseline.incomplete.id}`,
    "42501",
    app,
  );
  await rejected(
    (tx) =>
      tx`UPDATE qf.consumer_grant SET revoked_at=clock_timestamp() WHERE key_id=${baseline.completedKey.id}`,
    "42501",
    app,
  );
  pass("old gen0 inserts and direct app UPDATE paths fail closed");
  const first = await activate(0);
  const current1 = await insertSession(app, sessionRow(1));
  assert.equal(
    current1.key_bound_play_version_id,
    baseline.playRef.playVersionId,
  );
  assert.equal(current1.activation_generation, 1);
  await rejected((tx) => insertSession(tx, sessionRow(1)), "23505", app);
  await rejected(
    (tx) =>
      tx`UPDATE qf.consumer_session SET state_revision=state_revision+1 WHERE id=${baseline.incomplete.id}`,
    "23514",
    managed.sql,
    "VERSION_SUPERSEDED",
  );
  const completedAttempt = sessionRow(1);
  completedAttempt.key_id = baseline.completedKey.id;
  await rejected(
    (tx) => insertSession(tx, completedAttempt),
    "23514",
    app,
    "CONSUMER_KEY_COMPLETED",
  );
  pass(
    "one attempt per key/generation; legacy writes and completed entitlement restart rejected",
  );

  // An explicitly synthetic second play exercises distinct actual/issued tuples.
  // It is not a registered renderer or a runnable/approved product package.
  const second = structuredClone(baseline.play);
  second.snapshot.renderer = {
    ...second.snapshot.renderer,
    id: "synthetic-next-policy-renderer",
  };
  second.play.binding = {
    ...second.play.binding,
    operationKey: randomUUID(),
    renderer: second.snapshot.renderer,
  };
  const playBinding = consumerCanonicalText(second.play.binding, 8192),
    playSnapshot = consumerCanonicalText(second.snapshot, 65536);
  const nextRef = {
    productId: baseline.playRef.productId,
    playVersionId: randomUUID(),
    playSnapshotSha256: hash(playSnapshot),
  };
  await managed.sql`INSERT INTO qf.internal_play_version(id,product_id,slot,parent_version_id,parent_snapshot_sha256,operation_key,binding_text,binding_sha256,snapshot_text,snapshot_sha256,created_by,created_at)
   VALUES(${nextRef.playVersionId},${nextRef.productId},2,${second.snapshot.parent.versionId},${second.snapshot.parent.snapshotSha256},${second.play.binding.operationKey},${playBinding},${hash(playBinding)},${playSnapshot},${hash(playSnapshot)},${baseline.actorId},date_trunc('milliseconds',clock_timestamp()))`;
  await activate(1, nextRef);
  await rejected(
    (tx) => insertSession(tx, sessionRow(1)),
    "23514",
    app,
    "VERSION_SUPERSEDED",
  );
  const wrongIssue = sessionRow(2, nextRef);
  wrongIssue.issued_play_version_id = nextRef.playVersionId;
  wrongIssue.issued_play_snapshot_sha256 = nextRef.playSnapshotSha256;
  await rejected((tx) => insertSession(tx, wrongIssue), "23503", app);
  const current2 = await insertSession(app, sessionRow(2, nextRef));
  assert.equal(
    current2.key_bound_play_version_id,
    baseline.playRef.playVersionId,
  );
  assert.equal(current2.play_version_id, nextRef.playVersionId);
  await rejected(
    (tx) =>
      tx`UPDATE qf.consumer_session SET activation_generation=1 WHERE id=${current2.id as string}`,
    "23514",
  );
  await rejected(
    (tx) =>
      tx`UPDATE qf.consumer_product_head SET generation=1,play_version_id=${baseline.playRef.playVersionId},play_snapshot_sha256=${baseline.playRef.playSnapshotSha256} WHERE product_id=${nextRef.productId}`,
    "23514",
  );
  await rejected(
    (tx) =>
      tx`UPDATE qf.consumer_product_activation SET generation=2 WHERE id=${first.id as string}`,
    "23514",
  );
  pass(
    "distinct new attempt keeps full immutable original issue tuple; stale/forged tuples and generation reuse rejected",
  );
  const [originalReceipt] = await app<
    Row[]
  >`SELECT receipt_text,receipt_sha256 FROM qf.consumer_product_activation WHERE product_id=${baseline.playRef.productId} AND operation_key=${first.operation_key as string}`;
  const [currentHead] = await app<
    Row[]
  >`SELECT * FROM qf.consumer_product_head WHERE product_id=${baseline.playRef.productId}`;
  assert.equal(originalReceipt!.receipt_text, first.receipt_text);
  assert.equal(currentHead!.generation, 2);
  const [oldAttempt] = await app<
    Row[]
  >`SELECT * FROM qf.consumer_session WHERE id=${current1.id as string}`;
  assert.equal(oldAttempt!.activation_generation, 1);
  pass(
    "original activation receipt and old attempt survive a later mutable head",
  );
  const fks = await app<
    Row[]
  >`SELECT conname,pg_get_constraintdef(oid) definition,condeferrable,confdeltype,confupdtype FROM pg_constraint WHERE conrelid IN ('qf.consumer_session'::regclass,'qf.quiz_report'::regclass) AND contype='f'`;
  const attemptFk = fks.find(
    (f) => f.conname === "consumer_attempt_activation",
  );
  assert(attemptFk);
  assert(
    String(attemptFk.definition).includes(
      "REFERENCES qf.consumer_product_activation",
    ),
  );
  for (const name of [
    "consumer_session_key",
    "consumer_attempt_play",
    "consumer_attempt_activation",
    "quiz_report_session_final",
    "quiz_report_session_final_context",
  ]) {
    const fk = fks.find((f) => f.conname === name);
    assert(fk);
    assert.equal(fk.condeferrable, false);
    assert.equal(fk.confdeltype, "r");
    assert.equal(fk.confupdtype, "r");
  }
  pass(
    "immutable activation FK and both original report final-state FKs remain nondeferrable RESTRICT",
  );
  await oldGraphUnchanged();
  const oldHistory = normalized(
    await managed.sql`SELECT version,checksum,applied_at FROM qf_meta.schema_migrations ORDER BY version LIMIT 29`,
  );
  assert.deepEqual(oldHistory, baseline.history);
  pass(
    "original 29 migration receipts and all baseline rows unchanged after counterexamples",
  );
  const [catalog] = await app.unsafe<{ sha256: string }[]>(
    CONSUMER_CATALOG_QUERY,
  );
  await writeFile(
    path.join(directory, "latest-policy-check.result.json"),
    JSON.stringify(
      {
        instanceId: baseline.instanceId,
        root: process.cwd(),
        purpose: "test",
        applied,
        checks,
        catalogSha256: catalog!.sha256,
        status: "DB_SCHEMA_ONLY_NOT_RUNTIME_ACCEPTANCE",
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      status: "PASS_DB_SCHEMA_ONLY",
      checks: checks.length,
      applied,
      catalogSha256: catalog!.sha256,
    }),
  );
} catch (e) {
  await writeFile(
    path.join(directory, "latest-policy-check.failure.json"),
    JSON.stringify({
      instanceId: baseline.instanceId,
      checks,
      code: (e as { code?: string }).code ?? "HARNESS_ASSERTION",
      message:
        e instanceof assert.AssertionError
          ? e.message
          : "SQL_OR_HARNESS_FAILED",
      status: "FAILED_PRESERVED",
    }),
    { flag: "wx", mode: 0o600 },
  );
  console.error(
    JSON.stringify({
      status: "FAILED_PRESERVED",
      checks: checks.length,
      code: (e as { code?: string }).code ?? "HARNESS_ASSERTION",
    }),
  );
  process.exitCode = 1;
} finally {
  await app?.end({ timeout: 3 });
  await managed.close();
}
