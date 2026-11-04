/** Continuation of a successful owned synthetic service probe. No filesystem/native IO acceptance. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { openManagedDatabase } from "../../src/lib/db/management";
import { openSql } from "../../src/lib/db/client";
import { runInConsumerTransaction } from "../../src/lib/db/consumer-transaction";
import { lockConsumerAuthority } from "../../src/features/fulfillment/consumer-flow/authorization";
import { readFixedInternalPlay } from "../../src/features/product/internal-play/repository";
import { insertPersistedReport } from "../../src/features/report/persisted/repository";
import { verifyPersistedReportSnapshot } from "../../src/features/report/persisted/snapshot-contract";
import { consumerCompleteBindingSha256 } from "../../src/features/report/persisted/view-contracts";
import {
  consumerAnswersText,
  consumerProgressText,
  consumerSaveBindingText,
} from "../../src/lib/consumer-contract/v1/state";
import { consumerProductActivationBindingText } from "../../src/features/product/internal-play/activation-contracts";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const inputFile = path.resolve(process.argv[2] ?? "");
assert(inputFile.startsWith(process.cwd() + "/.cache/"));
const input = JSON.parse(await readFile(inputFile, "utf8"));
assert.equal(input.status, "PASS_BOUNDED_SERVICE_NO_IO");
const directory = path.dirname(inputFile),
  source = JSON.parse(
    await readFile(inputFile.replace(".result.json", ".intent.json"), "utf8"),
  ),
  seed = JSON.parse(
    await readFile(path.join(directory, "latest-attempts-seed.json"), "utf8"),
  );
const managed = await openManagedDatabase(input.instanceId);
assert.equal(managed.manifest.root, process.cwd());
assert.equal(managed.config.purpose, "test");
const resumeFile = process.argv[3] ? path.resolve(process.argv[3]) : null;
if (resumeFile) assert(resumeFile.startsWith(directory + "/"));
const previous = resumeFile
  ? JSON.parse(await readFile(resumeFile, "utf8"))
  : null;
const priorIntent = resumeFile
  ? JSON.parse(
      await readFile(
        resumeFile.replace(".failure.json", ".intent.json"),
        "utf8",
      ),
    )
  : null;
if (previous) {
  assert.equal(previous.code, "22023");
  assert.equal(previous.checks.length, 3);
  assert.equal(priorIntent.sourceRunId, input.runId);
}
const app = openSql(managed.config.database),
  checks: string[] = previous ? [...previous.checks] : [],
  runId = randomUUID(),
  prefix = path.join(directory, `controlled-invariants-${runId}`);
const fresh: { grantId: string; digest: string }[] =
  priorIntent?.fresh ??
  Array.from({ length: 18 }, () => ({
    grantId: randomUUID(),
    digest: hash(randomUUID()),
  }));
await writeFile(
  prefix + ".intent.json",
  JSON.stringify(
    {
      runId,
      instanceId: input.instanceId,
      root: process.cwd(),
      sourceRunId: input.runId,
      resumedFailure: resumeFile,
      keyId: source.keyId,
      fresh,
      scope:
        "stale writes; domain concurrency; 16-slot rotation; controlled completion before activation; original receipts; rollback-only expired/no-head historical exchange",
    },
    null,
    2,
  ),
  { flag: "wx", mode: 0o600 },
);
async function denied(
  work: () => PromiseLike<unknown>,
  code: string,
  message?: string,
) {
  let fault: unknown;
  try {
    await work();
  } catch (e) {
    fault = e;
  }
  assert.equal((fault as { code?: string })?.code, code);
  if (message) assert.equal((fault as Error).message, message);
}
const exchange = (sql: typeof app, grant: (typeof fresh)[number]) =>
  sql`SELECT qf.consumer_exchange_attempt(${seed.playRef.productId},${source.keyDigest},${grant.grantId},${grant.digest}) value`;
try {
  const [head] =
    await app`SELECT * FROM qf.consumer_product_head WHERE product_id=${seed.playRef.productId}`;
  assert(head);
  const attempts =
    await app`SELECT * FROM qf.consumer_session WHERE key_id=${source.keyId} ORDER BY activation_generation`;
  assert.equal(attempts.length, 2);
  const old = attempts[0]!,
    current = attempts[1]!;
  assert.equal(current.activation_generation, head.generation);
  const session = (row: typeof current) => ({
    productId: String(row.product_id),
    keyId: String(row.key_id),
    sessionId: String(row.id),
    playVersionId: String(row.play_version_id),
    playSnapshotSha256: String(row.play_snapshot_sha256),
  });
  if (!previous) {
    const [oldGrant] =
      await app`SELECT * FROM qf.consumer_grant WHERE key_id=${source.keyId} AND session_id=${old.id} AND revoked_at IS NULL AND expires_at>clock_timestamp() LIMIT 1`;
    assert(oldGrant);
    const emptyAnswers = consumerAnswersText([]),
      emptyProgress = consumerProgressText({ questionId: null });
    const staleBinding = consumerSaveBindingText({
      schemaVersion: "quizforge.consumer-save.v1",
      session: session(old),
      expectedStateRevision: old.state_revision,
      consumerStateAnswersSha256: hash(emptyAnswers),
      progressSha256: hash(emptyProgress),
    });
    const before = JSON.stringify(old);
    await denied(
      () =>
        app`SELECT qf.consumer_save_attempt(${old.product_id},${source.keyId},${old.id},${oldGrant.grant_id},${oldGrant.credential_digest},${old.state_revision},${staleBinding},${emptyAnswers},${emptyProgress},NULL)`,
      "23514",
      "VERSION_SUPERSEDED",
    );
    assert.equal(
      JSON.stringify(
        (await app`SELECT * FROM qf.consumer_session WHERE id=${old.id}`)[0],
      ),
      before,
    );
    checks.push(
      "strict stale save rejects exact VERSION_SUPERSEDED and leaves original row byte-equivalent",
    );
    const outcomes = await Promise.allSettled(
      fresh.slice(0, 2).map((g) => exchange(app, g)),
    );
    assert(outcomes.some((o) => o.status === "fulfilled"));
    for (const outcome of outcomes)
      if (outcome.status === "rejected")
        assert.equal(outcome.reason.code, "55P03");
    assert.equal(
      (
        await app`SELECT count(*)::integer n FROM qf.consumer_session WHERE key_id=${source.keyId} AND activation_generation=${head.generation}`
      )[0]!.n,
      1,
    );
    checks.push(
      "concurrent controlled exchange settles success or bounded NOWAIT contention with one generation attempt",
    );
    for (const grant of fresh.slice(2)) await exchange(app, grant);
    assert.equal(
      (
        await app`SELECT count(*)::integer n FROM qf.consumer_grant WHERE key_id=${source.keyId}`
      )[0]!.n,
      16,
    );
    await denied(
      () =>
        app`SELECT qf.consumer_lock_authority(${old.product_id},${source.keyId},${old.id},${oldGrant.grant_id},${oldGrant.credential_digest})`,
      "23514",
      "CONSUMER_ACCESS_DENIED",
    );
    assert.equal(
      (
        await app`SELECT count(*)::integer n FROM qf.consumer_grant WHERE key_id=${source.keyId} AND session_id<>${current.id}`
      )[0]!.n,
      0,
    );
    checks.push(
      "16-slot rotation writes the new session identity and invalidates the original old-attempt token",
    );
  }
  const latest = fresh.at(-1)!;
  const originalSnapshot = JSON.parse(seed.report.snapshot_text),
    answers = consumerAnswersText(originalSnapshot.answers),
    progress = consumerProgressText(originalSnapshot.progress);
  const bindingText = consumerSaveBindingText({
    schemaVersion: "quizforge.consumer-save.v1",
    session: session(current),
    expectedStateRevision: current.state_revision,
    consumerStateAnswersSha256: hash(answers),
    progressSha256: hash(progress),
  });
  if (!previous) {
    await app`SELECT qf.consumer_save_attempt(${current.product_id},${source.keyId},${current.id},${latest.grantId},${latest.digest},${current.state_revision},${bindingText},${answers},${progress},NULL)`;
  } else {
    assert.equal(current.state_revision, 1);
    assert.equal(
      (
        await app`SELECT count(*)::integer n FROM qf.quiz_report WHERE key_id=${source.keyId}`
      )[0]!.n,
      0,
    );
  }
  const report = await app.begin((sql) =>
    runInConsumerTransaction(
      sql,
      () => {},
      async (tx) => {
        const a = await lockConsumerAuthority(
          tx,
          latest.digest,
          String(current.id),
        );
        const play = await readFixedInternalPlay(tx, a.state.session);
        assert.deepEqual(
          play.snapshot.parentSnapshot,
          originalSnapshot.play.snapshot.parentSnapshot,
        );
        const binding = {
          schemaVersion: "quizforge.consumer-complete.v1" as const,
          session: a.state.session,
          expectedStateRevision: a.state.stateRevision,
          consumerStateAnswersSha256: a.state.consumerStateAnswersSha256,
          progressSha256: a.state.progressSha256,
          completionKey: randomUUID(),
        };
        const snapshot = await verifyPersistedReportSnapshot({
          ...originalSnapshot,
          binding,
          play,
          view: {
            ...originalSnapshot.view,
            reportId: randomUUID(),
            session: binding.session,
            completedAt: new Date().toISOString(),
            completionBindingSha256:
              await consumerCompleteBindingSha256(binding),
          },
        });
        return insertPersistedReport(tx, a.key, a.session, a.grant, snapshot);
      },
    ),
  );
  checks.push(
    "controlled report repository seals a validated immutable snapshot under exact locked authority (SQL-only)",
  );
  const [other] =
    await app`SELECT id,snapshot_sha256 FROM qf.internal_play_version WHERE product_id=${current.product_id} AND id<>${current.play_version_id} ORDER BY id LIMIT 1`;
  assert(other);
  const activation = consumerProductActivationBindingText({
    schemaVersion: "quizforge.consumer-product-activate.v1",
    productId: current.product_id,
    operationKey: randomUUID(),
    expectedGeneration: head.generation,
    playVersionId: other.id,
    playSnapshotSha256: other.snapshot_sha256,
  });
  await app`SELECT qf.consumer_activate_product(${activation},${source.actor.digest},${randomUUID()})`;
  const receiptBefore = JSON.stringify(
    (await app`SELECT * FROM qf.quiz_report WHERE key_id=${source.keyId}`)[0],
  );
  const historical = (
    await exchange(app, { grantId: randomUUID(), digest: hash(randomUUID()) })
  )[0]!.value;
  assert.equal(historical.destination, "report");
  assert.equal(historical.session.id, current.id);
  assert.equal(
    JSON.stringify(
      (await app`SELECT * FROM qf.quiz_report WHERE key_id=${source.keyId}`)[0],
    ),
    receiptBefore,
  );
  assert.equal(report.receipt.binding.session.sessionId, current.id);
  checks.push(
    "completion before activation remains original-session report-first exchange with unchanged persisted bytes",
  );
  const rollback = Error("ROLLBACK_ONLY_CLOCK_AND_HEAD_FIXTURE");
  try {
    await managed.sql.begin(async (sql) => {
      await sql`ALTER TABLE qf.access_key DISABLE TRIGGER consumer_key_change`;
      await sql`UPDATE qf.access_key SET issued_at=date_trunc('milliseconds',clock_timestamp())-interval '2 hours',expires_at=date_trunc('milliseconds',clock_timestamp())-interval '1 hour' WHERE id=${source.keyId}`;
      await sql`ALTER TABLE qf.access_key ENABLE TRIGGER consumer_key_change`;
      // Explicit rollback-only absence fixture; no application privilege or migration is changed.
      await sql`ALTER TABLE qf.consumer_product_head DISABLE TRIGGER USER`;
      await sql`DELETE FROM qf.consumer_product_head WHERE product_id=${current.product_id}`;
      await sql`ALTER TABLE qf.consumer_product_head ENABLE TRIGGER USER`;
      const [row] =
        await sql`SELECT qf.consumer_exchange_attempt(${current.product_id},${source.keyDigest},${randomUUID()},${hash(randomUUID())}) value`;
      assert.equal(row!.value.destination, "report");
      assert.equal(row!.value.session.id, current.id);
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  }
  assert.equal(
    JSON.stringify(
      (await app`SELECT * FROM qf.quiz_report WHERE key_id=${source.keyId}`)[0],
    ),
    receiptBefore,
  );
  assert(
    (
      await app`SELECT generation FROM qf.consumer_product_head WHERE product_id=${current.product_id}`
    )[0],
  );
  checks.push(
    "expired completed Key with no head still exchanges historical report; all clock/head fixture changes rolled back",
  );
  await writeFile(
    prefix + ".result.json",
    JSON.stringify(
      {
        status: "PASS_BOUNDED_SQL_INVARIANTS_NO_IO",
        runId,
        instanceId: input.instanceId,
        sourceRunId: input.runId,
        checks,
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      status: "PASS_BOUNDED_SQL_INVARIANTS_NO_IO",
      checks: checks.length,
      receipt: prefix + ".result.json",
    }),
  );
} catch (error) {
  await writeFile(
    prefix + ".failure.json",
    JSON.stringify(
      {
        status: "FAILED_PRESERVED_NO_RETRY",
        runId,
        instanceId: input.instanceId,
        checks,
        code: (error as { code?: string }).code,
        message: (error as Error).message,
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  throw error;
} finally {
  await app.end();
  await managed.close();
}
