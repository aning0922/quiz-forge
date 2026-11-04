/** Owned synthetic PG service probe. No physical source IO, final art, reset or automatic retry. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { openManagedDatabase } from "../../src/lib/db/management";
import { openSql } from "../../src/lib/db/client";
import { createStudioRequestBudget } from "../../src/lib/http-security/request-budget";
import { createConsumerRequestOwner } from "../../src/features/fulfillment/consumer-flow/request-owner";
import { createConsumerFlowService } from "../../src/features/fulfillment/consumer-flow/service";
import {
  createConsumerToken,
  digestConsumerToken,
  consumerCsrfForGrant,
} from "../../src/lib/consumer-contract/v1/credentials";
import { consumerCanonicalText } from "../../src/lib/consumer-contract/v1/integrity";
import {
  consumerAnswersSha256,
  consumerProgressSha256,
} from "../../src/lib/consumer-contract/v1/state";
import { consumerProductActivationBindingText } from "../../src/features/product/internal-play/activation-contracts";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const seedFile = path.resolve(process.argv[2] ?? "");
assert(seedFile.startsWith(process.cwd() + "/.cache/"));
const seed = JSON.parse(await readFile(seedFile, "utf8"));
const managed = await openManagedDatabase(seed.instanceId);
assert.equal(managed.manifest.root, process.cwd());
assert.equal(managed.config.purpose, "test");
const runId = randomUUID(),
  prefix = path.join(path.dirname(seedFile), `controlled-flow-${runId}`);
const rawKey = createConsumerToken("access-key"),
  keyDigest = await digestConsumerToken(rawKey, "access-key"),
  keyId = randomUUID();
const actor = {
  id: randomUUID(),
  sessionId: randomUUID(),
  digest: sha(randomUUID()),
};
await writeFile(
  prefix + ".intent.json",
  JSON.stringify(
    {
      runId,
      root: process.cwd(),
      instanceId: seed.instanceId,
      keyId,
      keyDigest,
      actor,
      scope:
        "new synthetic Key; actual request-owner exchange/read/save/resolve/logout; SQL activation; no source IO acceptance",
    },
    null,
    2,
  ),
  { flag: "wx", mode: 0o600 },
);
const app = openSql(managed.config.database),
  checks: string[] = [];
async function call<T>(
  work: (service: ReturnType<typeof createConsumerFlowService>) => Promise<T>,
) {
  const owner = createConsumerRequestOwner(
    managed.config,
    createStudioRequestBudget(new AbortController().signal),
  );
  try {
    return await work(createConsumerFlowService(owner));
  } finally {
    await owner.closeIfNotTransferred();
  }
}
async function credentials(token: string) {
  return {
    grantToken: token,
    csrfToken: await consumerCsrfForGrant(token),
    requestId: randomUUID(),
  };
}
try {
  const [head] =
    await app`SELECT * FROM qf.consumer_product_head WHERE product_id=${seed.playRef.productId}`;
  assert(head);
  const play = {
    productId: seed.playRef.productId,
    playVersionId: String(head.play_version_id),
    playSnapshotSha256: String(head.play_snapshot_sha256),
  };
  const binding = {
      schemaVersion: "quizforge.access-key-issue.v1",
      operationKey: randomUUID(),
      keyId,
      play,
      credentialDigest: keyDigest,
      validForSeconds: 3600,
    },
    text = consumerCanonicalText(binding, 8192);
  await app`INSERT INTO qf.access_key(id,product_id,play_version_id,play_snapshot_sha256,credential_digest,issue_operation_key,issue_binding_text,issue_binding_sha256,valid_for_seconds,issued_by,issued_at,expires_at) VALUES(${keyId},${play.productId},${play.playVersionId},${play.playSnapshotSha256},${keyDigest!},${binding.operationKey},${text},${sha(text)},3600,${seed.actorId},clock_timestamp(),clock_timestamp())`;
  // Exchange budget uses NOWAIT globally: normal HTTP probes serialize this phase.
  // Domain-lock concurrency is probed separately without mistaking admission denial for a domain defect.
  const exchanges = [
    await call((s) => s.exchange(rawKey)),
    await call((s) => s.exchange(rawKey)),
  ];
  assert.equal(
    exchanges[0]!.result.session.sessionId,
    exchanges[1]!.result.session.sessionId,
  );
  assert.equal(
    (
      await app`SELECT count(*)::integer n FROM qf.consumer_session WHERE key_id=${keyId}`
    )[0]!.n,
    1,
  );
  checks.push(
    "separate actual-owner exchanges reuse one current-generation attempt",
  );
  const session = exchanges[0]!.result.session,
    creds = await credentials(exchanges[0]!.cookieGrantToken);
  const view = await call((s) => s.readSession(creds, session.sessionId));
  assert.equal(view.outcome.kind, "editable");
  const input = {
    binding: {
      schemaVersion: "quizforge.consumer-save.v1" as const,
      session,
      expectedStateRevision: 0,
      consumerStateAnswersSha256: await consumerAnswersSha256([]),
      progressSha256: await consumerProgressSha256({ questionId: null }),
    },
    answers: [],
    progress: { questionId: null },
  };
  const saved = await call((s) => s.save(creds, session.sessionId, input));
  assert.equal(saved.kind, "applied-current");
  checks.push(
    "controlled save returns database-built exact receipt through the service decoder",
  );
  await managed.sql`INSERT INTO qf.operator(id,login_name,display_name,password_hash,role,status) SELECT ${actor.id},${"policy-" + actor.id},'合成服务夹具',password_hash,'admin','active' FROM qf.operator WHERE id=${seed.actorId}`;
  await managed.sql`WITH m AS(SELECT clock_timestamp() at) INSERT INTO qf.operator_session(id,token_digest,kind,operator_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at) SELECT ${actor.sessionId},${actor.digest},'authenticated',${actor.id},at,at,at+interval '30 minutes',at+interval '8 hours' FROM m`;
  const [other] =
    await app`SELECT id,snapshot_sha256 FROM qf.internal_play_version WHERE product_id=${play.productId} AND id<>${play.playVersionId} ORDER BY id LIMIT 1`;
  assert(other);
  const activation = consumerProductActivationBindingText({
    schemaVersion: "quizforge.consumer-product-activate.v1",
    productId: play.productId,
    operationKey: randomUUID(),
    expectedGeneration: head.generation,
    playVersionId: other.id,
    playSnapshotSha256: other.snapshot_sha256,
  });
  await app`SELECT qf.consumer_activate_product(${activation},${actor.digest},${randomUUID()})`;
  const original = await call((s) =>
    s.resolveSave(creds, session.sessionId, input.binding),
  );
  assert.equal(original.kind, "applied-current");
  const pending = { ...input.binding, expectedStateRevision: 1 };
  const terminal = await call((s) =>
    s.resolveSave(creds, session.sessionId, pending),
  );
  assert.equal(terminal.kind, "version-superseded");
  assert(!("report" in terminal));
  checks.push(
    "old exact receipt wins; lock-only RC recovery proves unresolved old-generation terminal",
  );
  const oldView = await call((s) => s.readSession(creds, session.sessionId));
  assert.equal(oldView.outcome.kind, "version-superseded");
  await assert.rejects(
    call((s) => s.readEntry(creds, session.sessionId)),
    { code: "VERSION_SUPERSEDED" },
  );
  const next = await call((s) => s.exchange(rawKey));
  assert.notEqual(next.result.session.sessionId, session.sessionId);
  const nextView = await call((s) =>
    s.readSession(
      { grantToken: next.cookieGrantToken },
      next.result.session.sessionId,
    ),
  );
  assert.equal(nextView.outcome.kind, "editable");
  assert("state" in nextView.outcome);
  assert.equal(nextView.outcome.state.stateRevision, 0);
  assert.deepEqual(nextView.outcome.state.answers, []);
  checks.push(
    "old entry denied and original-code reexchange creates empty new attempt without copying state",
  );
  await call((s) => s.logout(creds, session.sessionId));
  await assert.rejects(
    call((s) => s.readSession(creds, session.sessionId)),
    { code: "ACCESS_DENIED" },
  );
  checks.push("controlled exact logout revokes only the original grant");
  await writeFile(
    prefix + ".result.json",
    JSON.stringify(
      {
        status: "PASS_BOUNDED_SERVICE_NO_IO",
        instanceId: seed.instanceId,
        runId,
        checks,
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      status: "PASS_BOUNDED_SERVICE_NO_IO",
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
        instanceId: seed.instanceId,
        runId,
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
