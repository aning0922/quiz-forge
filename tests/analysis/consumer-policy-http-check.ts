/** In-process HTTP adapters with actual owned PG/request owners; no Next server or physical source IO. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { openManagedDatabase } from "../../src/lib/db/management";
import { openSql } from "../../src/lib/db/client";
import { issueToken, csrfForToken } from "../../src/lib/security/p2a-tokens";
import { SESSION_COOKIE } from "../../src/lib/auth/cookies";
import { createConsumerRequestOwner } from "../../src/features/fulfillment/consumer-flow/request-owner";
import { createConsumerFlowService } from "../../src/features/fulfillment/consumer-flow/service";
import { createConsumerActivationService } from "../../src/features/product/internal-play/activation-service";
import { createInternalPlayService } from "../../src/features/product/internal-play/service";
import { createAccessKeyService } from "../../src/features/fulfillment/access/service";
import { handleStudioConsumerHttpV1 } from "../../src/features/studio/consumer-access/http";
import {
  handleConsumerHttp,
  type ConsumerHttpEndpoint,
} from "../../src/features/fulfillment/consumer-flow/http/handler";
import {
  CONSUMER_COOKIE_NAME_V1,
  createConsumerToken,
  digestConsumerToken,
  consumerCsrfForGrant,
} from "../../src/lib/consumer-contract/v1/credentials";
import { consumerCanonicalText } from "../../src/lib/consumer-contract/v1/integrity";
import { consumerProductActivationBindingText } from "../../src/features/product/internal-play/activation-contracts";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const seedFile = path.resolve(process.argv[2] ?? "");
assert(seedFile.startsWith(process.cwd() + "/.cache/"));
const seed = JSON.parse(await readFile(seedFile, "utf8")),
  directory = path.dirname(seedFile),
  managed = await openManagedDatabase(seed.instanceId);
assert.equal(managed.config.purpose, "test");
assert.equal(managed.manifest.root, process.cwd());
const app = openSql(managed.config.database),
  runId = randomUUID(),
  prefix = path.join(directory, `policy-http-${runId}`),
  checks: string[] = [];
const operator = issueToken("session"),
  operatorId = randomUUID(),
  authSessionId = randomUUID(),
  keyId = randomUUID(),
  rawKey = createConsumerToken("access-key"),
  keyDigest = await digestConsumerToken(rawKey, "access-key");
await writeFile(
  prefix + ".intent.json",
  JSON.stringify(
    {
      runId,
      root: process.cwd(),
      instanceId: seed.instanceId,
      operatorId,
      authSessionId,
      keyId,
      keyDigest,
      scope:
        "new explicitly synthetic admin session and Key; real-PG HTTP adapters; original activation recovery; enable-before-complete",
    },
    null,
    2,
  ),
  { flag: "wx", mode: 0o600 },
);
const studioDeps = {
  createOwner: createConsumerRequestOwner,
  createPlayService: createInternalPlayService,
  createAccessService: createAccessKeyService,
  createActivationService: createConsumerActivationService,
  loadConfig: async () => managed.config,
};
const consumerDeps = {
  createOwner: createConsumerRequestOwner,
  createService: createConsumerFlowService,
  loadConfig: async () => managed.config,
};
function request(
  post: boolean,
  body: unknown,
  cookie: string,
  csrf: string,
  consumer = false,
) {
  return new Request(managed.config.origin + "/api/synthetic-policy-probe", {
    method: post ? "POST" : "GET",
    headers: {
      host: new URL(managed.config.origin).host,
      origin: managed.config.origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      cookie,
      [consumer ? "x-quizforge-consumer-csrf" : "x-csrf-token"]: csrf,
      "x-quizforge-consumer-exchange": "1",
    },
    ...(post ? { body: JSON.stringify(body) } : {}),
  });
}
try {
  await managed.sql`INSERT INTO qf.operator(id,login_name,display_name,password_hash,role,status) SELECT ${operatorId},${"policy-" + operatorId},'合成HTTP夹具',password_hash,'admin','active' FROM qf.operator WHERE id=${seed.actorId}`;
  await managed.sql`WITH m AS(SELECT clock_timestamp() at) INSERT INTO qf.operator_session(id,token_digest,kind,operator_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at) SELECT ${authSessionId},${operator.digest},'authenticated',${operatorId},at,at,at+interval '30 minutes',at+interval '8 hours' FROM m`;
  const [old] =
    await app`SELECT binding_text,generation FROM qf.consumer_product_activation WHERE product_id=${seed.playRef.productId} ORDER BY generation LIMIT 1`;
  assert(old);
  const original = JSON.parse(String(old.binding_text)),
    cookie = `${SESSION_COOKIE}=${operator.raw}`,
    csrf = csrfForToken(operator.raw, "session")!;
  for (const action of ["activate-play", "resolve-activation"] as const) {
    const response = await handleStudioConsumerHttpV1(
      request(true, original, cookie, csrf),
      { action, productId: original.productId },
      studioDeps,
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.kind, "applied");
    assert.equal(result.receipt.generation, old.generation);
    assert(result.head.generation > result.receipt.generation);
  }
  checks.push(
    "actual HTTP activation and resolve recover the original ledger before any unavailable source IO, independently of later head",
  );
  const [head] =
    await app`SELECT * FROM qf.consumer_product_head WHERE product_id=${seed.playRef.productId}`;
  assert(head);
  const play = {
      productId: String(head.product_id),
      playVersionId: String(head.play_version_id),
      playSnapshotSha256: String(head.play_snapshot_sha256),
    },
    issue = {
      schemaVersion: "quizforge.access-key-issue.v1",
      operationKey: randomUUID(),
      keyId,
      play,
      credentialDigest: keyDigest,
      validForSeconds: 3600,
    },
    issueText = consumerCanonicalText(issue, 8192);
  await app`INSERT INTO qf.access_key(id,product_id,play_version_id,play_snapshot_sha256,credential_digest,issue_operation_key,issue_binding_text,issue_binding_sha256,valid_for_seconds,issued_by,issued_at,expires_at) VALUES(${keyId},${play.productId},${play.playVersionId},${play.playSnapshotSha256},${keyDigest!},${issue.operationKey},${issueText},${hash(issueText)},3600,${operatorId},clock_timestamp(),clock_timestamp())`;
  const exchanged = await handleConsumerHttp(
    request(true, { rawKey }, "", "", true),
    { action: "exchange" },
    consumerDeps,
  );
  assert.equal(exchanged.status, 200);
  const exchangedBody = await exchanged.json(),
    setCookie = exchanged.headers.get("set-cookie");
  assert(setCookie);
  const grant = setCookie.split(";", 1)[0]!.split("=", 2)[1]!,
    consumerCookie = `${CONSUMER_COOKIE_NAME_V1}=${grant}`,
    consumerCsrf = (await consumerCsrfForGrant(grant))!;
  const endpoint = (action: ConsumerHttpEndpoint["action"]) =>
    ({
      action,
      sessionId: exchangedBody.session.sessionId,
    }) as ConsumerHttpEndpoint;
  const sessionResponse = await handleConsumerHttp(
      request(false, null, consumerCookie, consumerCsrf, true),
      endpoint("session"),
      consumerDeps,
    ),
    view = await sessionResponse.json();
  assert.equal(sessionResponse.status, 200);
  assert.equal(view.outcome.kind, "editable");
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
  await app`SELECT qf.consumer_activate_product(${activation},${operator.digest},${randomUUID()})`;
  const binding = {
    schemaVersion: "quizforge.consumer-complete.v1",
    session: exchangedBody.session,
    expectedStateRevision: view.outcome.state.stateRevision,
    consumerStateAnswersSha256: view.outcome.state.consumerStateAnswersSha256,
    progressSha256: view.outcome.state.progressSha256,
    completionKey: randomUUID(),
  };
  const completion = await handleConsumerHttp(
    request(true, binding, consumerCookie, consumerCsrf, true),
    endpoint("complete"),
    consumerDeps,
  );
  assert.equal(completion.status, 409);
  assert.equal((await completion.json()).code, "VERSION_SUPERSEDED");
  assert.equal(
    (
      await app`SELECT count(*)::integer n FROM qf.quiz_report WHERE key_id=${keyId}`
    )[0]!.n,
    0,
  );
  const resolved = await handleConsumerHttp(
      request(true, binding, consumerCookie, consumerCsrf, true),
      endpoint("resolve-complete"),
      consumerDeps,
    ),
    terminal = await resolved.json();
  assert.equal(resolved.status, 200);
  assert.equal(terminal.kind, "version-superseded");
  assert.deepEqual(terminal.binding, binding);
  assert.equal(resolved.headers.get("set-cookie"), null);
  checks.push(
    "actual HTTP enable-before-complete rejects 409 without report effects; lock-only resolve returns original-bound terminal without grant issuance",
  );
  await writeFile(
    prefix + ".result.json",
    JSON.stringify(
      {
        status: "PASS_IN_PROCESS_HTTP_REAL_PG_NO_IO",
        runId,
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
      status: "PASS_IN_PROCESS_HTTP_REAL_PG_NO_IO",
      checks: checks.length,
      receipt: prefix + ".result.json",
    }),
  );
} catch (e) {
  await writeFile(
    prefix + ".failure.json",
    JSON.stringify(
      {
        status: "FAILED_PRESERVED_NO_RETRY",
        runId,
        checks,
        code: (e as { code?: string }).code,
        message: (e as Error).message,
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  throw e;
} finally {
  await app.end();
  await managed.close();
}
