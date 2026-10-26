import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openTestDatabase } from "./p2a-fixture";
import { qztx2DbFixture } from "./qztx2-db-fixture";
import { createStudioRequestBudget } from "@/lib/http-security/request-budget";
import { createConsumerRequestOwner } from "@/features/fulfillment/consumer-flow/request-owner";
import { createConsumerFlowService } from "@/features/fulfillment/consumer-flow/service";
import {
  createConsumerToken,
  digestConsumerToken,
  consumerCsrfForGrant,
} from "@/lib/consumer-contract/v1/credentials";
import {
  issueAccessKeyBindingText,
  issueAccessKeyBindingSha256,
} from "@/features/fulfillment/access/contracts";
import {
  consumerCompleteBindingV2Schema,
  consumerCompleteBindingTextV2,
  consumerCompleteBindingSha256V2,
  consumerSaveInputV2Schema,
  consumerSaveBindingTextV2,
  consumerSaveBindingSha256V2,
  consumerMatchingSha256V2,
} from "@/lib/consumer-contract/v2/state";
import {
  consumerAnswersSha256,
  consumerProgressSha256,
} from "@/lib/consumer-contract/v1/state";
import {
  consumerCanonicalText,
  consumerTextSha256,
} from "@/lib/consumer-contract/v1/integrity";
import { consumerSessionViewV2Schema } from "@/features/fulfillment/consumer-flow/contracts-v2";
import { runInConsumerTransaction } from "@/lib/db/consumer-transaction";
import { lockConsumerAuthority } from "@/features/fulfillment/consumer-flow/authorization";
import { consumerDatabaseMoment } from "@/features/fulfillment/consumer-flow/transaction";
import { readConsumerPlaySource } from "@/features/fulfillment/consumer-flow/source";
import { verifyLockedGrant } from "@/features/fulfillment/access/repository";
import { prepareContentV3 } from "@/features/quizpack/content/v3-scoring-adapter";
import {
  projectPreparedResultV3,
  selectedDisplayAssetsV3,
} from "@/features/theme/preview/v3-projection";
import {
  verifyPersistedReportSnapshotV2,
  persistedReportSnapshotTextV2,
  persistedReportSnapshotSha256V2,
  type PersistedReportSnapshotV2,
} from "@/features/report/persisted/snapshot-contract-v2";
import { persistedReportDisplaySha256V2 } from "@/features/report/persisted/view-contracts-v2";
import { insertPersistedReport } from "@/features/report/persisted/repository";
import type { ConsumerFlowService } from "@/features/fulfillment/consumer-flow/service-contract";
const args = process.argv.slice(2);
if (
  args.length > 1 ||
  (args.length === 1 && args[0] !== "--finish-read-checks")
)
  throw Error("D2_REPORT_CHECK_ARGUMENTS");
const finishOnly = args[0] === "--finish-read-checks";
let stage = "setup";
/** Explicit additive check: real report repository/SQL and pure composer; no registered execution/native-media claim. */
async function main() {
  const db = await openTestDatabase();
  try {
    assert.equal(db.config.purpose, "test");
    const productId = "synthetic-d2";
    const [present] = await db.app
      .sql`SELECT EXISTS(SELECT 1 FROM qf.product WHERE id=${productId}) present`;
    if (!present?.present) await qztx2DbFixture(db);
    const [play] = await db.app
      .sql`SELECT * FROM qf.internal_play_version WHERE product_id=${productId}`;
    assert.ok(play);
    const metadata = JSON.parse(String(play.snapshot_text));
    assert.equal(
      metadata.parentSnapshot.baseline.id,
      "synthetic-d2-sql-metadata",
    );
    const [source] = await db.app
      .sql`SELECT canonical_content_text FROM qf.draft_revision WHERE product_id=${productId} AND draft_id=${metadata.parentSnapshot.target.draftId} AND revision=${metadata.parentSnapshot.target.revision}`;
    assert.ok(source);
    const content = JSON.parse(String(source.canonical_content_text));
    const rawKey = createConsumerToken("access-key"),
      credentialDigest = await digestConsumerToken(rawKey, "access-key");
    assert.ok(credentialDigest);
    const issue = {
      schemaVersion: "quizforge.access-key-issue.v1" as const,
      operationKey: randomUUID(),
      keyId: randomUUID(),
      play: {
        productId,
        playVersionId: String(play.id),
        playSnapshotSha256: String(play.snapshot_sha256),
      },
      credentialDigest,
      validForSeconds: 3600,
    };
    await db.app
      .sql`INSERT INTO qf.access_key(id,product_id,play_version_id,play_snapshot_sha256,credential_digest,issue_operation_key,issue_binding_text,issue_binding_sha256,valid_for_seconds,issued_by,issued_at,expires_at) VALUES(${issue.keyId},${productId},${play.id},${play.snapshot_sha256},${credentialDigest},${issue.operationKey},${issueAccessKeyBindingText(issue)},${await issueAccessKeyBindingSha256(issue)},3600,${play.created_by},clock_timestamp(),clock_timestamp())`;
    async function call<T>(work: (service: ConsumerFlowService) => Promise<T>) {
      const owner = createConsumerRequestOwner(
        db.config,
        createStudioRequestBudget(new AbortController().signal),
      );
      try {
        return await work(createConsumerFlowService(owner));
      } finally {
        await owner.closeIfNotTransferred();
      }
    }
    const exchanged = await call((s) => s.exchange(rawKey)),
      session = exchanged.result.session,
      grantToken = exchanged.cookieGrantToken;
    const credentials = {
      grantToken,
      csrfToken: await consumerCsrfForGrant(grantToken),
      requestId: randomUUID(),
    };
    const answers = content.bindings.witnesses.entries[0].answers,
      progress = { questionId: null },
      matchingContext = {
        schemaVersion: "quiz-matching-context.v1" as const,
        preference: "any" as const,
        policyRef: content.core.scoringDefinition.matchingPolicy.ref,
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
    assert.equal(
      (await call((s) => s.save(credentials, session.sessionId, save))).kind,
      "applied-current",
    );
    const digest = await digestConsumerToken(grantToken, "grant");
    assert.ok(digest);
    const binding = consumerCompleteBindingV2Schema.parse({
      ...save.binding,
      schemaVersion: "quizforge.consumer-complete.v2",
      expectedStateRevision: 1,
      completionKey: randomUUID(),
    });
    const snapshot = await db.app.sql.begin(async (sql) =>
      runInConsumerTransaction(
        sql,
        () => {},
        async (tx) => {
          const a = await lockConsumerAuthority(tx, digest, session.sessionId);
          assert.equal(a.state.schemaVersion, "quizforge.consumer-state.v2");
          const fixed = await readConsumerPlaySource(tx, a.state),
            prepared = prepareContentV3(fixed.source.content);
          assert.ok(prepared.ok);
          if (!prepared.ok) throw Error("PREPARE_FAILED");
          const projected = projectPreparedResultV3(prepared.value, {
            schemaVersion: "quiz-scoring-input.v2",
            answers: a.state.answers,
            matchingContext,
          });
          assert.ok(projected.ok);
          if (!projected.ok) throw Error("COMPOSITION_FAILED");
          return verifyPersistedReportSnapshotV2({
            schemaVersion: "quizforge.consumer-report-snapshot.v2",
            binding,
            play: fixed.play,
            answers: a.state.answers,
            progress: a.state.progress,
            matchingContext,
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
    async function rawInsert(
      value: PersistedReportSnapshotV2,
      contextSha: string | null = value.binding.matchingContextSha256,
    ) {
      const b = value.binding,
        v = value.view,
        s = b.session,
        text = persistedReportSnapshotTextV2(value);
      return db.app.sql.begin(async (tx) => {
        await tx`INSERT INTO qf.quiz_report(id,key_id,session_id,product_id,play_version_id,play_snapshot_sha256,state_revision,consumer_state_answers_sha256,progress_sha256,matching_context_sha256,completion_key,binding_text,binding_sha256,snapshot_text,snapshot_sha256,display_sha256,completed_at) VALUES(${v.reportId},${s.keyId},${s.sessionId},${s.productId},${s.playVersionId},${s.playSnapshotSha256},${b.expectedStateRevision},${b.consumerStateAnswersSha256},${b.progressSha256},${contextSha},${b.completionKey},${consumerCompleteBindingTextV2(b)},${await consumerCompleteBindingSha256V2(b)},${text},${await persistedReportSnapshotSha256V2(value)},${await persistedReportDisplaySha256V2(v)},${v.completedAt})`;
        throw Error("UNEXPECTED_INSERT_MUST_ROLLBACK");
      });
    }
    const rejected = (e: unknown) =>
      ["23514", "23503", "23001"].includes((e as { code?: string }).code ?? "");
    const other = content.bindings.slots.characters.find(
      (c: { resultRef: { id: string } }) =>
        c.resultRef.id !== snapshot.view.display.selectedResultRef.id,
    );
    assert.ok(other);
    const foreignAsset = selectedDisplayAssetsV3(content, [other.nameArt])[0]!;
    if (!finishOnly) {
      stage = "sql-null-context";
      await assert.rejects(rawInsert(snapshot, null), rejected);
      stage = "context-source-mismatch";
      const wrongContext = structuredClone(snapshot),
        femaleContext = { ...matchingContext, preference: "female" as const };
      const preparedFemale = prepareContentV3(content);
      assert.ok(preparedFemale.ok);
      if (!preparedFemale.ok) throw Error("FEMALE_PREPARE_FAILED");
      const female = projectPreparedResultV3(preparedFemale.value, {
        schemaVersion: "quiz-scoring-input.v2",
        answers,
        matchingContext: femaleContext,
      });
      assert.ok(female.ok);
      if (!female.ok) throw Error("FEMALE_COMPOSE_FAILED");
      wrongContext.matchingContext = femaleContext;
      wrongContext.binding.matchingContextSha256 =
        await consumerMatchingSha256V2(femaleContext);
      wrongContext.score = female.value.score;
      wrongContext.view.display = female.value.display;
      wrongContext.view.completionBindingSha256 =
        await consumerCompleteBindingSha256V2(wrongContext.binding);
      await assert.rejects(rawInsert(wrongContext), rejected);
      stage = "forged-evidence";
      const forged = structuredClone(snapshot);
      forged.view.display.body.answers[0]!.prompt = "Synthetic forged evidence";
      forged.view.display.bodySha256 = await consumerTextSha256(
        consumerCanonicalText(forged.view.display.body, 524288),
      );
      await assert.rejects(rawInsert(forged), rejected);
      stage = "other-character-decoration";
      const expanded = structuredClone(snapshot);
      expanded.view.display.assets.push(foreignAsset);
      await assert.rejects(rawInsert(expanded), rejected);
    }
    stage = "immutable-report-insert";
    const persisted = await db.app.sql.begin(async (sql) =>
      runInConsumerTransaction(
        sql,
        () => {},
        async (tx) => {
          const a = await lockConsumerAuthority(tx, digest, session.sessionId);
          await verifyLockedGrant(tx, a.key, a.session, a.locator);
          return insertPersistedReport(tx, a.key, a.session, a.grant, snapshot);
        },
      ),
    );
    assert.equal(
      persisted.receipt.schemaVersion,
      "quizforge.consumer-report-receipt.v2",
    );
    assert.equal(
      persisted.receipt.reportSnapshotSha256,
      await persistedReportSnapshotSha256V2(snapshot),
    );
    stage = "completion-operation-conflict";
    const conflicting = {
      ...binding,
      matchingContextSha256: await consumerMatchingSha256V2({
        ...matchingContext,
        preference: "female",
      }),
    };
    if (!finishOnly) {
      assert.equal(
        (await call((s) => s.complete(credentials, session.sessionId, binding)))
          .kind,
        "applied",
      );
      assert.equal(
        (
          await call((s) =>
            s.resolveComplete(credentials, session.sessionId, conflicting),
          )
        ).kind,
        "operation-conflict",
      );
    }
    const changedBinding = {
      schemaVersion: "quizforge.consumer-save.v2" as const,
      session,
      expectedStateRevision: 1,
      consumerStateAnswersSha256: binding.consumerStateAnswersSha256,
      progressSha256: binding.progressSha256,
      matchingContextSha256: conflicting.matchingContextSha256,
    };
    const bindingText = consumerSaveBindingTextV2(changedBinding),
      bindingSha256 = await consumerSaveBindingSha256V2(changedBinding),
      receiptText = consumerCanonicalText(
        {
          schemaVersion: "quizforge.consumer-save-receipt.v2",
          binding: changedBinding,
          bindingSha256,
          appliedStateRevision: 2,
          savedAt: new Date().toISOString(),
        },
        8192,
      );
    await assert.rejects(
      db.app.sql.begin(async (tx) => {
        await tx`UPDATE qf.consumer_session SET state_revision=2,matching_context_text=${consumerCanonicalText({ ...matchingContext, preference: "female" }, 4096)},matching_context_sha256=${changedBinding.matchingContextSha256},last_binding_text=${bindingText},last_binding_sha256=${bindingSha256},last_receipt_text=${receiptText},last_receipt_sha256=${await consumerTextSha256(receiptText)} WHERE id=${session.sessionId}`;
        throw Error("UNEXPECTED_UPDATE_ROLLBACK");
      }),
      rejected,
    );
    stage = "immutable-read-and-resource-scope";
    const read = await call((s) =>
      s.readReport({ grantToken }, session.sessionId),
    );
    assert.deepEqual(read.view.display, snapshot.view.display);
    await assert.rejects(
      call((s) =>
        s.readResource({ grantToken }, session.sessionId, {
          resourceId: foreignAsset.resourceRef.id,
          resourceVersion: foreignAsset.resourceRef.version,
          sha256: foreignAsset.sha256,
        }),
      ),
      (e: unknown) => (e as { code?: string }).code === "ACCESS_DENIED",
    );
    const reopened = await call((s) => s.exchange(rawKey));
    assert.equal(reopened.result.destination, "report");
    const completed = consumerSessionViewV2Schema.parse(
      await call((s) =>
        s.readSession(
          { grantToken: reopened.cookieGrantToken },
          session.sessionId,
        ),
      ),
    );
    assert.equal(completed.outcome.kind, "completed");
    const [relation] = await db.app
      .sql`SELECT condeferrable,condeferred,confmatchtype FROM pg_constraint WHERE conrelid='qf.quiz_report'::regclass AND conname='quiz_report_session_final_context'`;
    assert.equal(relation?.confmatchtype, "s");
    assert.equal(relation?.condeferrable, false);
    assert.equal(relation?.condeferred, false);
    console.log(
      JSON.stringify({
        evidence:
          "actual PG report repository and consumer read/replay services / actual pure composer / synthetic registry metadata / no registered execution or media IO claim",
        passed: finishOnly
          ? [
              "post-completion-update-rejected",
              "immutable-report-read",
              "cross-character-resource-access-denied",
              "original-link-read-only-report",
              "immediate-match-simple-full-tuple-fk",
            ]
          : [
              "24-answer-six-volume-snapshot",
              "sql-null-report-context-rejected",
              "sql-context-source-mismatch-rejected",
              "rehashed-forged-evidence-rejected",
              "other-character-decoration-rejected",
              "immutable-insert-and-read",
              "original-completion-replay",
              "same-key-different-context-conflict",
              "post-completion-update-rejected",
              "cross-character-resource-access-denied",
              "original-link-read-only-report",
              "immediate-match-simple-full-tuple-fk",
            ],
        volumes: snapshot.view.display.body.volumes.length,
        answers: snapshot.view.display.body.answers.length,
      }),
    );
  } finally {
    await db.close();
  }
}
main().catch((e) => {
  console.error(
    JSON.stringify({
      check: "qztx2-report",
      stage,
      frames: e.stack
        ?.split("\n")
        .filter((frame: string) => frame.trim().startsWith("at "))
        .slice(0, 3),
      code: e.code ?? null,
      message:
        e instanceof assert.AssertionError ? "ASSERTION_FAILED" : e.message,
    }),
  );
  process.exitCode = 1;
});
