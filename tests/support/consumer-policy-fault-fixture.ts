/** Dedicated latest-policy fault fixtures; all answers and identities are synthetic.
 * Reuses the prior SQL-only completion projection without claiming filesystem IO. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { openManagedDatabase } from "../../src/lib/db/management";
import { openSql } from "../../src/lib/db/client";
import {
  runInConsumerTransaction,
  type ConsumerTx,
} from "../../src/lib/db/consumer-transaction";
import { createStudioRequestBudget } from "../../src/lib/http-security/request-budget";
import { createConsumerRequestOwner } from "../../src/features/fulfillment/consumer-flow/request-owner";
import {
  consumerServiceCall,
  consumerWrite,
} from "../../src/features/fulfillment/consumer-flow/transaction";
import { lockConsumerAuthority } from "../../src/features/fulfillment/consumer-flow/authorization";
import { insertPersistedReport } from "../../src/features/report/persisted/repository";
import { readFixedInternalPlay } from "../../src/features/product/internal-play/repository";
import {
  verifyPersistedReportSnapshot,
  persistedReportSnapshotSha256,
} from "../../src/features/report/persisted/snapshot-contract";
import { consumerCompleteBindingSha256 } from "../../src/features/report/persisted/view-contracts";
import { consumerCanonicalText } from "../../src/lib/consumer-contract/v1/integrity";
import {
  consumerAnswersText,
  consumerProgressText,
  consumerSaveBindingText,
} from "../../src/lib/consumer-contract/v1/state";
import {
  createConsumerToken,
  digestConsumerToken,
  consumerCsrfForGrant,
} from "../../src/lib/consumer-contract/v1/credentials";
import { issueToken } from "../../src/lib/security/p2a-tokens";
import { consumerProductActivationBindingText } from "../../src/features/product/internal-play/activation-contracts";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
export async function openPolicyFaultFixture() {
  const seedFile = path.resolve(process.env.QF_POLICY_SEED ?? "");
  assert(seedFile.startsWith(process.cwd() + "/.cache/"));
  const seed = JSON.parse(await readFile(seedFile, "utf8"));
  const managed = await openManagedDatabase(seed.instanceId);
  assert.equal(managed.manifest.root, process.cwd());
  assert.equal(managed.config.purpose, "test");
  const app = openSql(managed.config.database, 1),
    directory = path.dirname(seedFile);
  const runId = randomUUID(),
    prefix = path.join(directory, `policy-recovery-fault-${runId}`);
  const actor = {
    id: randomUUID(),
    sessionId: randomUUID(),
    token: issueToken("session"),
  };
  await writeFile(
    prefix + ".intent.json",
    JSON.stringify(
      {
        runId,
        instanceId: seed.instanceId,
        root: process.cwd(),
        actorId: actor.id,
        operatorSessionId: actor.sessionId,
        scope:
          "completion final SQL port; real result loss/backend termination; original-identity recovery; no reset or resource IO",
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  try {
    await managed.sql`INSERT INTO qf.operator(id,login_name,display_name,password_hash,role,status) SELECT ${actor.id},${"policy-" + actor.id},'合成恢复故障夹具',password_hash,'admin','active' FROM qf.operator WHERE id=${seed.actorId}`;
    await managed.sql`WITH m AS(SELECT clock_timestamp() at) INSERT INTO qf.operator_session(id,token_digest,kind,operator_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at) SELECT ${actor.sessionId},${actor.token.digest},'authenticated',${actor.id},at,at,at+interval '30 minutes',at+interval '8 hours' FROM m`;
  } catch (e) {
    await app.end();
    await managed.close();
    throw e;
  }
  const write = async (suffix: string, value: unknown) =>
    writeFile(prefix + suffix, JSON.stringify(value, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  const request = async <T>(
    work: (owner: ReturnType<typeof createConsumerRequestOwner>) => Promise<T>,
  ) => {
    const owner = createConsumerRequestOwner(
      managed.config,
      createStudioRequestBudget(new AbortController().signal),
    );
    try {
      return await work(owner);
    } finally {
      await owner.closeIfNotTransferred();
    }
  };
  async function prepare(name: string) {
    const [head] =
      await app`SELECT * FROM qf.consumer_product_head WHERE product_id=${seed.playRef.productId}`;
    assert(head);
    const keyId = randomUUID(),
      issueOperation = randomUUID(),
      freshGrantId = randomUUID(),
      grantToken = createConsumerToken("grant"),
      keyDigest = hash(randomUUID()),
      grantDigest = (await digestConsumerToken(grantToken, "grant"))!;
    const playRef = {
      productId: String(head.product_id),
      playVersionId: String(head.play_version_id),
      playSnapshotSha256: String(head.play_snapshot_sha256),
    };
    const issue = {
        schemaVersion: "quizforge.access-key-issue.v1",
        operationKey: issueOperation,
        keyId,
        play: playRef,
        credentialDigest: keyDigest,
        validForSeconds: 3600,
      },
      issueText = consumerCanonicalText(issue, 8192);
    await write(`.${name}.setup-intent.json`, {
      keyId,
      issue,
      freshGrantId,
      grantDigest,
      originalGeneration: head.generation,
    });
    await app`INSERT INTO qf.access_key(id,product_id,play_version_id,play_snapshot_sha256,credential_digest,issue_operation_key,issue_binding_text,issue_binding_sha256,valid_for_seconds,issued_by,issued_at,expires_at) VALUES(${keyId},${playRef.productId},${playRef.playVersionId},${playRef.playSnapshotSha256},${keyDigest},${issueOperation},${issueText},${hash(issueText)},3600,${actor.id},clock_timestamp(),clock_timestamp())`;
    const [exchanged] =
      await app`SELECT qf.consumer_exchange_attempt(${playRef.productId},${keyDigest},${freshGrantId},${grantDigest}) value`;
    assert(exchanged);
    const row = exchanged.value.session,
      session = { ...playRef, keyId, sessionId: String(row.id) };
    const originalSnapshot = JSON.parse(seed.report.snapshot_text),
      answers = consumerAnswersText(originalSnapshot.answers),
      progress = consumerProgressText(originalSnapshot.progress);
    const save = consumerSaveBindingText({
      schemaVersion: "quizforge.consumer-save.v1",
      session,
      expectedStateRevision: 0,
      consumerStateAnswersSha256: hash(answers),
      progressSha256: hash(progress),
    });
    await app`SELECT qf.consumer_save_attempt(${playRef.productId},${keyId},${session.sessionId},${freshGrantId},${grantDigest},0,${save},${answers},${progress},NULL)`;
    const binding = {
      schemaVersion: "quizforge.consumer-complete.v1" as const,
      session,
      expectedStateRevision: 1,
      consumerStateAnswersSha256: hash(answers),
      progressSha256: hash(progress),
      completionKey: randomUUID(),
    };
    const play = await app.begin((sql) =>
      runInConsumerTransaction(
        sql,
        () => {},
        (tx) => readFixedInternalPlay(tx, playRef),
      ),
    );
    assert.deepEqual(
      play.snapshot.parentSnapshot,
      originalSnapshot.play.snapshot.parentSnapshot,
    );
    const snapshot = await verifyPersistedReportSnapshot({
      ...originalSnapshot,
      binding,
      play,
      view: {
        ...originalSnapshot.view,
        parent: play.snapshot.parent,
        renderer: play.snapshot.renderer,
        font: play.snapshot.parentSnapshot.font,
        mapping: play.snapshot.mapping,
        mappingSha256: play.snapshot.mappingSha256,
        reportId: randomUUID(),
        session,
        completedAt: new Date().toISOString(),
        completionBindingSha256: await consumerCompleteBindingSha256(binding),
      },
    });
    const credentials = {
      grantToken,
      csrfToken: await consumerCsrfForGrant(grantToken),
      requestId: randomUUID(),
    };
    // Private recovery credential plus exact original operation survive any UNKNOWN; never printed or committed.
    await write(`.${name}.operation-intent.json`, {
      binding,
      bindingSha256: await consumerCompleteBindingSha256(binding),
      snapshotSha256: await persistedReportSnapshotSha256(snapshot),
      reportId: snapshot.view.reportId,
      credentials,
    });
    async function finalCompletion(
      afterInsert?: (tx: ConsumerTx) => Promise<void>,
      beforeTransaction?: () => Promise<void>,
    ) {
      return request((owner) =>
        consumerServiceCall(owner, "complete", (c, observation) =>
          c.sql(async (db, check) => {
            await beforeTransaction?.();
            return consumerWrite(db, check, observation, async (tx) => {
              try {
                const a = await lockConsumerAuthority(
                  tx,
                  grantDigest,
                  session.sessionId,
                );
                const report = await insertPersistedReport(
                  tx,
                  a.key,
                  a.session,
                  a.grant,
                  snapshot,
                );
                await afterInsert?.(tx);
                return report.receipt;
              } catch (error) {
                await write(`.${name}.native-fault-${randomUUID()}.json`, {
                  code: (error as { code?: string }).code,
                  message: (error as Error).message,
                  stack: (error as Error).stack,
                });
                throw error;
              }
            });
          }),
        ),
      );
    }
    async function advance() {
      const [current] =
        await app`SELECT generation,play_version_id FROM qf.consumer_product_head WHERE product_id=${playRef.productId}`;
      const [other] =
        await app`SELECT id,snapshot_sha256 FROM qf.internal_play_version WHERE product_id=${playRef.productId} AND id<>${current!.play_version_id} ORDER BY id LIMIT 1`;
      assert(other);
      const activation = {
        schemaVersion: "quizforge.consumer-product-activate.v1",
        productId: playRef.productId,
        operationKey: randomUUID(),
        expectedGeneration: current!.generation,
        playVersionId: other.id,
        playSnapshotSha256: other.snapshot_sha256,
      };
      await write(
        `.${name}.activation-${activation.operationKey}.intent.json`,
        activation,
      );
      return app`SELECT qf.consumer_activate_product(${consumerProductActivationBindingText(activation)},${actor.token.digest},${randomUUID()})`;
    }
    const reportRows = () =>
      app`SELECT id,binding_sha256,snapshot_sha256,completion_key FROM qf.quiz_report WHERE key_id=${keyId}`;
    const grantRows = () =>
      app`SELECT grant_id,session_id,credential_digest,revoked_at,issued_at,expires_at FROM qf.consumer_grant WHERE key_id=${keyId} ORDER BY slot`;
    return {
      name,
      keyId,
      binding,
      credentials,
      snapshot,
      finalCompletion,
      advance,
      reportRows,
      grantRows,
    };
  }
  async function backendGone(pid: number) {
    const deadline = performance.now() + 2000;
    while (performance.now() < deadline) {
      const [row] =
        await managed.sql`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid=${pid} AND usename=${managed.config.database.user}) alive`;
      if (!row!.alive) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw Error("OWNED_BACKEND_STILL_ACTIVE");
  }
  return {
    managed,
    app,
    prefix,
    runId,
    write,
    request,
    prepare,
    backendGone,
    close: async () => {
      await app.end();
      await managed.close();
    },
  };
}
