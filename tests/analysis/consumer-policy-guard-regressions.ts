/** Two bounded real-PG regressions for the reviewed batch-A guards. Requires the
 * successful formal upgrade harness in an owned synthetic managed test instance.
 * No reset, retries, runtime activation API, or consumer service is exercised. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type postgres from "postgres";
import { openManagedDatabase } from "../../src/lib/db/management";
import { openSql } from "../../src/lib/db/client";
import { consumerCanonicalText } from "../../src/lib/consumer-contract/v1/integrity";
import { consumerProductActivationBindingText } from "../../src/features/product/internal-play/activation-contracts";
import {
  readConsumerUpgradeComparison,
  assertConsumerUpgradeUnchanged,
} from "../support/consumer-upgrade-comparison";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
type Row = Record<string, unknown>;
const baselineFile = path.resolve(process.argv[2] ?? "");
assert(baselineFile.startsWith(process.cwd() + "/.cache/"));
const baseline = JSON.parse(await readFile(baselineFile, "utf8"));
const directory = path.dirname(baselineFile);
const previous = JSON.parse(
  await readFile(
    path.join(directory, "latest-policy-check.result.json"),
    "utf8",
  ),
);
assert.equal(previous.instanceId, baseline.instanceId);
assert.equal(previous.status, "DB_SCHEMA_ONLY_NOT_RUNTIME_ACCEPTANCE");
assert.deepEqual(previous.applied, ["0030_consumer_latest_attempts"]);
const managed = await openManagedDatabase(baseline.instanceId);
assert.equal(managed.config.purpose, "test");
assert.equal(managed.manifest.root, process.cwd());
let app: postgres.Sql | undefined, first: postgres.ReservedSql | undefined;
let firstOpen = false;
const checks: string[] = [];
let result: Row | undefined;
try {
  const ddl = await readFile(
    "migrations/p2a/0030_consumer_latest_attempts.sql",
    "utf8",
  );
  const [migration] =
    await managed.sql`SELECT checksum FROM qf_meta.schema_migrations WHERE version='0030_consumer_latest_attempts'`;
  assert.equal(migration!.checksum, sha(ddl));
  const [head] = await managed.sql<
    Row[]
  >`SELECT * FROM qf.consumer_product_head WHERE product_id=${baseline.playRef.productId}`;
  assert(head);
  assert.equal(head.generation, 2);
  const [current] = await managed.sql<
    Row[]
  >`SELECT * FROM qf.consumer_session WHERE key_id=${baseline.incompleteKey.id} AND activation_generation=${head.generation as number}`;
  assert(current);
  const play = {
    productId: String(head.product_id),
    playVersionId: String(head.play_version_id),
    playSnapshotSha256: String(head.play_snapshot_sha256),
  };
  const issueBindings = [0, 1].map(() => ({
    schemaVersion: "quizforge.access-key-issue.v1",
    operationKey: randomUUID(),
    keyId: randomUUID(),
    play,
    credentialDigest: sha(randomUUID()),
    validForSeconds: 3600,
  }));
  const grantId = randomUUID(),
    grantDigest = sha(randomUUID());
  await writeFile(
    path.join(directory, "policy-guard-regressions.intent.json"),
    JSON.stringify(
      {
        instanceId: baseline.instanceId,
        root: process.cwd(),
        ddlSha256: sha(ddl),
        head,
        issueBindings,
        grantId,
        grantDigest,
        scope:
          "direct concurrent issue; pure stale/expired logout with rollback-only clock fixtures",
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  app = openSql(managed.config.database);
  const issue = async (
    sql: postgres.ReservedSql | postgres.TransactionSql,
    binding: (typeof issueBindings)[number],
  ) => {
    const text = consumerCanonicalText(binding, 8192);
    return sql`INSERT INTO qf.access_key(id,product_id,play_version_id,play_snapshot_sha256,credential_digest,issue_operation_key,issue_binding_text,issue_binding_sha256,valid_for_seconds,issued_by,issued_at,expires_at)
      VALUES(${binding.keyId},${play.productId},${play.playVersionId},${play.playSnapshotSha256},${binding.credentialDigest},${binding.operationKey},${text},${sha(text)},3600,${baseline.actorId},clock_timestamp(),clock_timestamp())`;
  };
  // No service or explicit product lock precedes either INSERT. The first raw
  // INSERT's own trigger must leave product/head locks compatible with the second.
  first = await app.reserve();
  await first.unsafe("BEGIN");
  firstOpen = true;
  await first.unsafe("SET LOCAL statement_timeout='2000ms'");
  await issue(first, issueBindings[0]!);
  await app.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout='1000ms'`;
    await tx`SET LOCAL statement_timeout='2000ms'`;
    await issue(tx, issueBindings[1]!);
  });
  const [visibility] = await managed.sql<
    { first_visible: boolean; second_committed: boolean }[]
  >`
    SELECT EXISTS(SELECT 1 FROM qf.access_key WHERE id=${issueBindings[0]!.keyId}) first_visible,
      EXISTS(SELECT 1 FROM qf.access_key WHERE id=${issueBindings[1]!.keyId}) second_committed`;
  assert.deepEqual(visibility, {
    first_visible: false,
    second_committed: true,
  });
  await first.unsafe("COMMIT");
  firstOpen = false;
  first.release();
  first = undefined;
  checks.push(
    "second direct app issue committed while first direct app issue transaction still held its locks",
  );
  await app`INSERT INTO qf.consumer_grant(key_id,slot,session_id,grant_id,credential_digest,issued_at,expires_at)
    VALUES(${baseline.incompleteKey.id},1,${current.id as string},${grantId},${grantDigest},clock_timestamp(),clock_timestamp())`;
  const [grantBefore] = await managed.sql<
    { body: Row }[]
  >`SELECT to_jsonb(g) body FROM qf.consumer_grant g WHERE grant_id=${grantId}`;
  assert(grantBefore);
  const rollback = "EXPECTED_GUARD_FIXTURE_ROLLBACK";
  const logoutObservations: Row[] = [];
  try {
    await managed.sql.begin(async (tx) => {
      // A rollback-only third activation makes this exact grant stale. It never
      // becomes a lasting runtime/product activation or a new consumer attempt.
      const binding = {
        schemaVersion: "quizforge.consumer-product-activate.v1",
        productId: play.productId,
        operationKey: randomUUID(),
        expectedGeneration: 2,
        playVersionId: play.playVersionId,
        playSnapshotSha256: play.playSnapshotSha256,
      };
      const text = consumerProductActivationBindingText(binding);
      await tx`INSERT INTO qf.consumer_product_activation(id,product_id,operation_key,expected_generation,generation,play_version_id,play_snapshot_sha256,binding_text,binding_sha256,activated_by,operator_session_id,request_id,activated_at,receipt_text,receipt_sha256)
        VALUES(${randomUUID()},${play.productId},${binding.operationKey},2,3,${play.playVersionId},${play.playSnapshotSha256},${text},${sha(text)},${baseline.actorId},${baseline.operatorSessionId},${randomUUID()},clock_timestamp(),'','')`;
      await tx`SELECT * FROM qf.access_key WHERE id=${baseline.incompleteKey.id} FOR UPDATE`;
      await tx`SELECT * FROM qf.consumer_session WHERE id=${current.id as string} FOR UPDATE`;
      await tx`SELECT * FROM qf.consumer_grant WHERE grant_id=${grantId} FOR UPDATE`;
      for (const expired of [false, true]) {
        try {
          await tx.savepoint(async (point) => {
            if (expired) {
              // Synthetic deadline setup only; original guards are enabled again
              // before the actual pure-logout UPDATE, and the entire fixture rolls back.
              await point`ALTER TABLE qf.access_key DISABLE TRIGGER consumer_key_change`;
              await point`WITH moment AS MATERIALIZED(SELECT date_trunc('milliseconds',clock_timestamp()) at)
                UPDATE qf.access_key SET issued_at=m.at-interval '1 second'-valid_for_seconds*interval '1 second',expires_at=m.at-interval '1 second' FROM moment m WHERE id=${baseline.incompleteKey.id}`;
              await point`ALTER TABLE qf.access_key ENABLE TRIGGER consumer_key_change`;
              await point`ALTER TABLE qf.consumer_grant DISABLE TRIGGER consumer_grant_change`;
              await point`WITH moment AS MATERIALIZED(SELECT date_trunc('milliseconds',clock_timestamp()) at)
                UPDATE qf.consumer_grant SET issued_at=m.at-interval '9 hours',expires_at=m.at-interval '1 hour' FROM moment m WHERE grant_id=${grantId}`;
              await point`ALTER TABLE qf.consumer_grant ENABLE TRIGGER consumer_grant_change`;
            }
            const [before] = await point<
              { body: Row }[]
            >`SELECT to_jsonb(g) body FROM qf.consumer_grant g WHERE grant_id=${grantId}`;
            const [after] = await point<
              { body: Row }[]
            >`UPDATE qf.consumer_grant g SET revoked_at=clock_timestamp() WHERE grant_id=${grantId} RETURNING to_jsonb(g) body`;
            assert(before && after);
            assert.equal(before.body.revoked_at, null);
            assert.notEqual(after.body.revoked_at, null);
            const { revoked_at: oldRevocation, ...oldIdentity } = before.body;
            const { revoked_at: newRevocation, ...newIdentity } = after.body;
            assert.equal(oldRevocation, null);
            assert.notEqual(newRevocation, null);
            assert.deepEqual(newIdentity, oldIdentity);
            logoutObservations.push({
              expired,
              before: before.body,
              after: after.body,
            });
            throw Error(rollback);
          });
        } catch (e) {
          assert.equal((e as Error).message, rollback);
        }
        checks.push(
          expired
            ? "expired stale grant can revoke only itself with original guards restored"
            : "stale grant can revoke only itself before current-attempt checks",
        );
      }
      // Changing token data is not pure logout and must still fail for this stale attempt.
      try {
        await tx.savepoint(async (point) => {
          await point`UPDATE qf.consumer_grant SET credential_digest=${sha(randomUUID())},revoked_at=clock_timestamp() WHERE grant_id=${grantId}`;
          throw Error("FORGED_LOGOUT_ACCEPTED");
        });
      } catch (e) {
        assert.equal((e as { code?: string }).code, "23514");
        assert.equal((e as Error).message, "VERSION_SUPERSEDED");
      }
      checks.push(
        "token-changing stale logout rejected specifically as VERSION_SUPERSEDED",
      );
      throw Error(rollback);
    });
  } catch (e) {
    assert.equal((e as Error).message, rollback);
  }
  const [grantAfter] = await managed.sql<
    { body: Row }[]
  >`SELECT to_jsonb(g) body FROM qf.consumer_grant g WHERE grant_id=${grantId}`;
  assert.deepEqual(grantAfter, grantBefore);
  const [headAfter] = await managed.sql<
    Row[]
  >`SELECT * FROM qf.consumer_product_head WHERE product_id=${play.productId}`;
  assert.deepEqual(headAfter, head);
  for (const [table, before] of [
    ["access_key", baseline.incompleteKey],
    ["access_key", baseline.completedKey],
    ["consumer_session", baseline.incomplete],
    ["consumer_session", baseline.completed],
    ["quiz_report", baseline.report],
  ] as const)
    assertConsumerUpgradeUnchanged(
      await readConsumerUpgradeComparison(managed.sql, table, before),
    );
  checks.push(
    "rollback restored grant/head/deadlines; every original legacy row and canonical report unchanged",
  );
  result = {
    status: "PASS_DB_GUARD_REGRESSIONS_ONLY",
    instanceId: baseline.instanceId,
    root: process.cwd(),
    ddlSha256: sha(ddl),
    checks,
    visibility,
    issueKeyIds: issueBindings.map((b) => b.keyId),
    originalGrantId: grantId,
    logoutObservations,
  };
} catch (e) {
  await writeFile(
    path.join(directory, "policy-guard-regressions.failure.json"),
    JSON.stringify(
      {
        instanceId: baseline.instanceId,
        checks,
        code: (e as { code?: string }).code ?? "HARNESS_ASSERTION",
        message:
          e instanceof assert.AssertionError
            ? e.message
            : "SQL_OR_HARNESS_FAILED",
        status: "FAILED_PRESERVED",
      },
      null,
      2,
    ),
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
  if (first) {
    if (firstOpen) await first.unsafe("ROLLBACK");
    first.release();
  }
  await app?.end({ timeout: 3 });
  await managed.close();
}
if (result) {
  await writeFile(
    path.join(directory, "policy-guard-regressions.result.json"),
    JSON.stringify({ ...result, connectionClosed: true }, null, 2),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      status: result.status,
      checks: checks.length,
      connectionClosed: true,
    }),
  );
}
