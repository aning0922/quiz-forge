/** Explicit owned PG check after exact 0031. Does not reset any fixture or rerun A. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { openManagedDatabase } from "../../src/lib/db/management";
import { openSql } from "../../src/lib/db/client";
import { consumerProductActivationBindingText } from "../../src/features/product/internal-play/activation-contracts";
import { consumerCanonicalText } from "../../src/lib/consumer-contract/v1/integrity";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const seedFile = path.resolve(process.argv[2] ?? "");
assert(seedFile.startsWith(process.cwd() + "/.cache/"));
const seed = JSON.parse(await readFile(seedFile, "utf8")),
  directory = path.dirname(seedFile);
const db = await openManagedDatabase(seed.instanceId);
assert.equal(db.config.purpose, "test");
assert.equal(db.manifest.root, process.cwd());
const resume = process.argv[3] === "--resume-after-selector-fix";
const prefix = resume ? "controlled-auth-resume" : "controlled-auth";
const previousIntent = resume
  ? JSON.parse(
      await readFile(
        path.join(directory, "controlled-auth.intent.json"),
        "utf8",
      ),
    )
  : null;
const previousFailure = resume
  ? JSON.parse(
      await readFile(
        path.join(directory, "controlled-auth.failure.json"),
        "utf8",
      ),
    )
  : null;
if (resume) {
  assert.equal(previousIntent.instanceId, seed.instanceId);
  assert.equal(previousIntent.root, process.cwd());
  assert.equal(previousFailure.checks.length, 2);
  assert(
    previousFailure.message.includes('column reference "product" is ambiguous'),
  );
}
const actors: { kind: string; id: string; session: string; digest: string }[] =
  resume
    ? previousIntent.actors
    : ["admin", "operator", "pending"].map((kind) => ({
        kind,
        id: randomUUID(),
        session: randomUUID(),
        digest: hash(randomUUID()),
      }));
await writeFile(
  path.join(directory, prefix + ".intent.json"),
  JSON.stringify(
    {
      instanceId: seed.instanceId,
      root: process.cwd(),
      actors,
      scope: "four operator authorization cases and direct ACL/exchange checks",
    },
    null,
    2,
  ),
  { flag: "wx", mode: 0o600 },
);
const app = openSql(db.config.database),
  checks: string[] = [];
const snapshot = async () =>
  JSON.stringify(
    (
      await db.sql`SELECT (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM qf.consumer_product_activation t) ledger,(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY product_id),'[]'::jsonb) FROM qf.consumer_product_head t) head,(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM qf.audit_event t) audit`
    )[0],
  );
async function denied(
  work: () => PromiseLike<unknown>,
  code: string,
  message?: string,
) {
  let gotCode, gotMessage;
  try {
    await work();
    throw Error("COUNTEREXAMPLE_ACCEPTED");
  } catch (e) {
    gotCode = (e as { code?: string }).code;
    gotMessage = (e as Error).message;
    if (!gotCode) throw e;
  }
  assert.equal(gotCode, code);
  if (message) assert.equal(gotMessage, message);
}
try {
  const [history] =
    await db.sql`SELECT checksum FROM qf_meta.schema_migrations WHERE version='0031_consumer_controlled_writes'`;
  assert.equal(
    history!.checksum,
    "c78cad364630daa315b2289c7b0e744ee317543419d3ca7ff5d3a50495ef3d92",
  );
  for (const a of resume ? [] : actors) {
    await db.sql`INSERT INTO qf.operator(id,login_name,display_name,password_hash,role,status) SELECT ${a.id},${"policy-" + a.id},'合成授权夹具',CASE WHEN ${a.kind}='pending' THEN NULL ELSE password_hash END,${a.kind === "operator" ? "operator" : "admin"}::qf.operator_role,'active' FROM qf.operator WHERE id=${seed.actorId}`;
    await db.sql`WITH m AS(SELECT clock_timestamp() at) INSERT INTO qf.operator_session(id,token_digest,kind,operator_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at) SELECT ${a.session},${a.digest},'authenticated',${a.id},at,at,at+interval '30 minutes',at+interval '8 hours' FROM m`;
  }
  const [head] =
    await db.sql`SELECT * FROM qf.consumer_product_head WHERE product_id=${seed.playRef.productId}`;
  assert.equal(head!.generation, 2);
  const binding = consumerProductActivationBindingText({
    schemaVersion: "quizforge.consumer-product-activate.v1",
    productId: seed.playRef.productId,
    operationKey: randomUUID(),
    expectedGeneration: 2,
    playVersionId: seed.playRef.playVersionId,
    playSnapshotSha256: seed.playRef.playSnapshotSha256,
  });
  const before = await snapshot();
  if (resume) {
    const [repair] =
      await db.sql`SELECT checksum FROM qf_meta.schema_migrations WHERE version='0032_consumer_activation_product_selector'`;
    assert.equal(
      repair!.checksum,
      "1266d0362702472c98326deb113d980289deb1d37d7646550abd533bd6d78315",
    );
    checks.push(...previousFailure.checks);
  } else {
    await denied(
      () =>
        app`SELECT * FROM qf.consumer_activate_product(${binding},${actors[1]!.digest},${randomUUID()})`,
      "23514",
      "CONSUMER_CAPABILITY_DENIED",
    );
    assert.equal(await snapshot(), before);
    checks.push(
      "operator direct activate denied; ledger/head/audit byte-equal",
    );
    await denied(
      () =>
        app`SELECT * FROM qf.consumer_activate_product(${binding},${actors[2]!.digest},${randomUUID()})`,
      "23514",
      "CONSUMER_OPERATOR_REQUIRED",
    );
    assert.equal(await snapshot(), before);
    checks.push(
      "account_actor-ineligible pending-password admin session denied without effects",
    );
  }
  try {
    await app.begin(async (tx) => {
      const [r] =
        await tx`SELECT * FROM qf.consumer_activate_product(${binding},${actors[0]!.digest},${randomUUID()})`;
      assert.equal(r!.generation, 3);
      const [h] =
        await tx`SELECT generation FROM qf.consumer_product_head WHERE product_id=${seed.playRef.productId}`;
      assert.equal(h!.generation, 3);
      throw Error("EXPECTED_ADMIN_ROLLBACK");
    });
  } catch (e) {
    assert.equal((e as Error).message, "EXPECTED_ADMIN_ROLLBACK");
  }
  assert.equal(await snapshot(), before);
  checks.push(
    "eligible admin activation succeeds; intentional rollback restores state",
  );
  const issued = {
    schemaVersion: "quizforge.access-key-issue.v1",
    operationKey: randomUUID(),
    keyId: randomUUID(),
    play: {
      productId: head!.product_id,
      playVersionId: head!.play_version_id,
      playSnapshotSha256: head!.play_snapshot_sha256,
    },
    credentialDigest: hash(randomUUID()),
    validForSeconds: 3600,
  };
  const text = consumerCanonicalText(issued, 8192);
  await app`INSERT INTO qf.access_key(id,product_id,play_version_id,play_snapshot_sha256,credential_digest,issue_operation_key,issue_binding_text,issue_binding_sha256,valid_for_seconds,issued_by,issued_at,expires_at) VALUES(${issued.keyId},${issued.play.productId},${issued.play.playVersionId},${issued.play.playSnapshotSha256},${issued.credentialDigest},${issued.operationKey},${text},${hash(text)},3600,${actors[0]!.id},clock_timestamp(),clock_timestamp())`;
  const voidText = consumerCanonicalText(
    {
      schemaVersion: "quizforge.access-key-void-unused.v1",
      productId: issued.play.productId,
      operationKey: randomUUID(),
      keyId: issued.keyId,
      issueBindingSha256: hash(text),
    },
    4096,
  );
  const [voided] =
    await app`SELECT * FROM qf.consumer_void_unused_key(${issued.play.productId},${issued.keyId},${voidText},${actors[1]!.digest})`;
  assert.equal(voided!.voided_by, actors[1]!.id);
  assert.notEqual(voided!.revoked_at, null);
  checks.push("eligible operator retains direct controlled void capability");
  await denied(
    () =>
      app`UPDATE qf.access_key SET expires_at=clock_timestamp() WHERE id=${issued.keyId}`,
    "42501",
  );
  await denied(
    () =>
      app`SELECT qf.consumer_service_operator(${actors[0]!.digest},'version:seal-internal')`,
    "42501",
  );
  checks.push("app direct UPDATE and private helper EXECUTE remain denied");
  await writeFile(
    path.join(directory, prefix + ".result.json"),
    JSON.stringify(
      {
        status: "PASS_CONTROLLED_AUTH_ONLY",
        instanceId: seed.instanceId,
        checks,
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      status: "PASS_CONTROLLED_AUTH_ONLY",
      checks: checks.length,
    }),
  );
} catch (e) {
  await writeFile(
    path.join(directory, prefix + ".failure.json"),
    JSON.stringify(
      {
        status: "FAILED_PRESERVED",
        checks,
        code: (e as { code?: string }).code ?? "HARNESS_ASSERTION",
        message:
          e instanceof assert.AssertionError ? e.message : (e as Error).message,
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
  await app.end({ timeout: 3 });
  await db.close();
}
