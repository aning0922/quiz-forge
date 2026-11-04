/** One additive v2 matching-context path using the existing synthetic D2 SQL fixture.
 * Candidate/renderer metadata remains explicitly synthetic; no native-media, final art or runtime registration proof. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { openManagedDatabase } from "../../src/lib/db/management";
import { createDatabase } from "../../src/lib/db/client";
import { runInConsumerTransaction } from "../../src/lib/db/consumer-transaction";
import { digestToken } from "../../src/lib/security/p2a-tokens";
import { createStudioRequestBudget } from "../../src/lib/http-security/request-budget";
import { qztx2DbFixture } from "../db/qztx2-db-fixture";
import { createConsumerRequestOwner } from "../../src/features/fulfillment/consumer-flow/request-owner";
import { createConsumerFlowService } from "../../src/features/fulfillment/consumer-flow/service";
import {
  consumerServiceCall,
  consumerWrite,
  consumerDatabaseMoment,
} from "../../src/features/fulfillment/consumer-flow/transaction";
import { lockConsumerAuthority } from "../../src/features/fulfillment/consumer-flow/authorization";
import { readConsumerPlaySource } from "../../src/features/fulfillment/consumer-flow/source";
import { insertPersistedReport } from "../../src/features/report/persisted/repository";
import { verifyPersistedReportSnapshotV2 } from "../../src/features/report/persisted/snapshot-contract-v2";
import { prepareContentV3 } from "../../src/features/quizpack/content/v3-scoring-adapter";
import { projectPreparedResultV3 } from "../../src/features/theme/preview/v3-projection";
import { consumerProductActivationBindingText } from "../../src/features/product/internal-play/activation-contracts";
import {
  digestConsumerToken,
  consumerCsrfForGrant,
} from "../../src/lib/consumer-contract/v1/credentials";
import {
  consumerAnswersSha256,
  consumerProgressSha256,
} from "../../src/lib/consumer-contract/v1/state";
import {
  consumerSaveInputV2Schema,
  consumerCompleteBindingV2Schema,
  consumerCompleteBindingSha256V2,
  consumerMatchingSha256V2,
} from "../../src/lib/consumer-contract/v2/state";
const seedFile = path.resolve(process.argv[2] ?? "");
assert(seedFile.startsWith(process.cwd() + "/.cache/"));
const seed = JSON.parse(await readFile(seedFile, "utf8")),
  directory = path.dirname(seedFile),
  admin = await openManagedDatabase(seed.instanceId);
assert.equal(admin.manifest.root, process.cwd());
assert.equal(admin.config.purpose, "test");
const app = await createDatabase(admin.config),
  db = {
    config: admin.config,
    app,
    admin,
    close: async () => {
      await app.close();
      await admin.close();
    },
  };
const runId = randomUUID(),
  prefix = path.join(directory, `policy-v2-${runId}`),
  checks: string[] = [];
const write = (suffix: string, value: unknown) =>
  writeFile(prefix + suffix, JSON.stringify(value, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
await write(".intent.json", {
  runId,
  root: process.cwd(),
  instanceId: seed.instanceId,
  productId: "synthetic-d2",
  scope:
    "existing D2 synthetic SQL fixture; actual v2 owner save; controlled final-SQL completion; original receipt recovery; no native IO or final source admission",
});
const request = async <T>(
  work: (owner: ReturnType<typeof createConsumerRequestOwner>) => Promise<T>,
) => {
  const owner = createConsumerRequestOwner(
    db.config,
    createStudioRequestBudget(new AbortController().signal),
  );
  try {
    return await work(owner);
  } finally {
    await owner.closeIfNotTransferred();
  }
};
try {
  const fixture = await qztx2DbFixture(db);
  await write(".fixture-result.json", {
    productId: fixture.play.snapshot.parent.productId,
    playId: fixture.play.play.id,
    playSha256: fixture.play.play.snapshotSha256,
    sourceScope: fixture.source.scope,
    qualification: "synthetic-platform-and-renderer-metadata-only",
  });
  const productId = fixture.play.snapshot.parent.productId;
  const activation = {
    schemaVersion: "quizforge.consumer-product-activate.v1",
    productId,
    operationKey: randomUUID(),
    expectedGeneration: 0,
    playVersionId: fixture.play.play.id,
    playSnapshotSha256: fixture.play.play.snapshotSha256,
  };
  await write(".activation-intent.json", activation);
  await app.sql`SELECT qf.consumer_activate_product(${consumerProductActivationBindingText(activation)},${digestToken(fixture.auth.credentials.sessionToken!, "session")!},${randomUUID()})`;
  const issued = await fixture.issue(),
    exchange = await request((owner) =>
      createConsumerFlowService(owner).exchange(issued.rawKey),
    );
  const session = exchange.result.session,
    grantToken = exchange.cookieGrantToken,
    digest = (await digestConsumerToken(grantToken, "grant"))!,
    credentials = {
      grantToken,
      csrfToken: await consumerCsrfForGrant(grantToken),
      requestId: randomUUID(),
    };
  const content = fixture.prepared.candidate.facts.canonicalContentText;
  const parsed = JSON.parse(content),
    answers = parsed.bindings.witnesses.entries[0].answers,
    progress = { questionId: null },
    matchingContext = {
      schemaVersion: "quiz-matching-context.v1" as const,
      preference: "female" as const,
      policyRef: parsed.core.scoringDefinition.matchingPolicy.ref,
    };
  const save = consumerSaveInputV2Schema.parse({
    binding: {
      schemaVersion: "quizforge.consumer-save.v2",
      session,
      expectedStateRevision: 0,
      consumerStateAnswersSha256: await consumerAnswersSha256(answers),
      progressSha256: await consumerProgressSha256(progress),
      matchingContextSha256: await consumerMatchingSha256V2(matchingContext),
    },
    answers,
    progress,
    matchingContext,
  });
  const binding = consumerCompleteBindingV2Schema.parse({
    ...save.binding,
    schemaVersion: "quizforge.consumer-complete.v2",
    expectedStateRevision: 1,
    completionKey: randomUUID(),
  });
  await write(".operation-intent.json", {
    binding,
    bindingSha256: await consumerCompleteBindingSha256V2(binding),
    save,
    credentials,
  });
  const saved = await request((owner) =>
    createConsumerFlowService(owner).save(credentials, session.sessionId, save),
  );
  assert.equal(saved.kind, "applied-current");
  assert("state" in saved);
  assert.equal(saved.state.schemaVersion, "quizforge.consumer-state.v2");
  assert("matchingContext" in saved.state);
  assert.deepEqual(saved.state.matchingContext, matchingContext);
  checks.push(
    "actual-owner v2 save persists exact matching context and digest",
  );
  const snapshot = await app.sql.begin((sql) =>
    runInConsumerTransaction(
      sql,
      () => {},
      async (tx) => {
        const a = await lockConsumerAuthority(tx, digest, session.sessionId),
          fixed = await readConsumerPlaySource(tx, a.state),
          prepared = prepareContentV3(fixed.source.content);
        assert(prepared.ok);
        assert(a.state.schemaVersion === "quizforge.consumer-state.v2");
        const projected = projectPreparedResultV3(prepared.value, {
          schemaVersion: "quiz-scoring-input.v2",
          answers: a.state.answers,
          matchingContext: a.state.matchingContext,
        });
        assert(projected.ok);
        return verifyPersistedReportSnapshotV2({
          schemaVersion: "quizforge.consumer-report-snapshot.v2",
          binding,
          play: fixed.play,
          answers: a.state.answers,
          progress: a.state.progress,
          matchingContext: a.state.matchingContext,
          score: projected.value.score,
          view: {
            schemaVersion: "quizforge.consumer-report-display.v2",
            reportId: randomUUID(),
            session,
            completedAt: await consumerDatabaseMoment(tx),
            completionBindingSha256:
              await consumerCompleteBindingSha256V2(binding),
            parent: fixed.play.snapshot.parent,
            renderer: fixed.play.snapshot.renderer,
            font: fixed.play.snapshot.parentSnapshot.font,
            mapping: fixed.play.snapshot.mapping,
            mappingSha256: fixed.play.snapshot.mappingSha256,
            display: projected.value.display,
          },
        });
      },
    ),
  );
  const beforeGrants = JSON.stringify(
    await app.sql`SELECT * FROM qf.consumer_grant WHERE key_id=${session.keyId} ORDER BY slot`,
  );
  const report = await request((owner) =>
    consumerServiceCall(owner, "complete", (c, observation) =>
      c.sql((database, check) =>
        consumerWrite(database, check, observation, async (tx) => {
          const a = await lockConsumerAuthority(tx, digest, session.sessionId);
          return insertPersistedReport(tx, a.key, a.session, a.grant, snapshot);
        }),
      ),
    ),
  );
  assert.equal(
    report.receipt.schemaVersion,
    "quizforge.consumer-report-receipt.v2",
  );
  assert.deepEqual(report.receipt.binding, binding);
  checks.push(
    "controlled completion on an actual Drizzle connection seals v2 matching-context snapshot",
  );
  const before = JSON.stringify(
    await app.sql`SELECT * FROM qf.quiz_report WHERE key_id=${session.keyId}`,
  );
  const recovered = await request((owner) =>
    createConsumerFlowService(owner).resolveComplete(
      credentials,
      session.sessionId,
      binding,
    ),
  );
  assert.equal(recovered.kind, "applied");
  assert("report" in recovered);
  assert.equal(recovered.report.reportId, report.receipt.reportId);
  assert.deepEqual(recovered.report.binding, binding);
  const saveRecovered = await request((owner) =>
    createConsumerFlowService(owner).resolveSave(
      credentials,
      session.sessionId,
      save.binding,
    ),
  );
  assert.equal(saveRecovered.kind, "applied-current");
  assert.equal(
    JSON.stringify(
      await app.sql`SELECT * FROM qf.quiz_report WHERE key_id=${session.keyId}`,
    ),
    before,
  );
  assert.equal(
    JSON.stringify(
      await app.sql`SELECT * FROM qf.consumer_grant WHERE key_id=${session.keyId} ORDER BY slot`,
    ),
    beforeGrants,
  );
  checks.push(
    "original v2 completion and save receipts recover with unchanged report/grant rows and no replay",
  );
  await write(".result.json", {
    status: "PASS_V2_REAL_PG_MATCHING_NO_NATIVE_IO",
    runId,
    instanceId: seed.instanceId,
    binding,
    reportId: report.receipt.reportId,
    reportSnapshotSha256: report.receipt.reportSnapshotSha256,
    checks,
    resourceIo: { acquired: false, stopProof: null },
  });
  console.log(
    JSON.stringify({
      status: "PASS_V2_REAL_PG_MATCHING_NO_NATIVE_IO",
      checks: checks.length,
      receipt: prefix + ".result.json",
    }),
  );
} catch (e) {
  await write(".failure.json", {
    status: "FAILED_PRESERVED_NO_REPLAY",
    checks,
    code: (e as { code?: string }).code,
    message: (e as Error).message,
  });
  throw e;
} finally {
  await db.close();
  await write(".fixture-close.json", {
    fixtureAppPoolClosed: true,
    fixtureOwnerPoolClosed: true,
    resourceIoAcquired: false,
  });
}
