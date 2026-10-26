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
  consumerSaveInputV2Schema,
  consumerSaveBindingSha256V2,
  consumerMatchingSha256V2,
  consumerCompleteBindingV2Schema,
} from "@/lib/consumer-contract/v2/state";
import {
  consumerAnswersSha256,
  consumerProgressSha256,
} from "@/lib/consumer-contract/v1/state";
import { consumerSessionViewV2Schema } from "@/features/fulfillment/consumer-flow/contracts-v2";
import type { ConsumerFlowService } from "@/features/fulfillment/consumer-flow/service-contract";
/** Explicit standalone check, never part of the destructive/reset DB suite. Leaves its synthetic receipts in place. */
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
    const snapshot = JSON.parse(String(play.snapshot_text));
    assert.equal(snapshot.schemaVersion, "quizforge.internal-play-snapshot.v2");
    assert.equal(
      snapshot.parentSnapshot.baseline.id,
      "synthetic-d2-sql-metadata",
    );
    const [source] = await db.app
      .sql`SELECT canonical_content_text FROM qf.draft_revision WHERE product_id=${productId} AND draft_id=${snapshot.parentSnapshot.target.draftId} AND revision=${snapshot.parentSnapshot.target.revision}`;
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
    const exchange = await call((s) => s.exchange(rawKey)),
      grantToken = exchange.cookieGrantToken,
      session = exchange.result.session;
    const credentials = {
      grantToken,
      csrfToken: await consumerCsrfForGrant(grantToken),
      requestId: randomUUID(),
    };
    const initial = consumerSessionViewV2Schema.parse(
      await call((s) => s.readSession({ grantToken }, session.sessionId)),
    );
    assert.equal(initial.outcome.kind, "editable");
    if (initial.outcome.kind !== "editable") throw Error("NOT_EDITABLE");
    assert.equal(initial.outcome.state.matchingContext, null);
    assert.equal(
      initial.outcome.state.matchingContextSha256,
      await consumerMatchingSha256V2(null),
    );
    assert.equal(initial.outcome.state.stateRevision, 0);
    const q = content.core.questions[0],
      answers = [{ questionId: q.ref.id, optionId: q.options[0].ref.id }],
      progress = { questionId: q.ref.id };
    async function input(
      revision: number,
      preference: "male" | "female" | "any",
    ) {
      const matchingContext = {
        schemaVersion: "quiz-matching-context.v1" as const,
        preference,
        policyRef: content.core.scoringDefinition.matchingPolicy.ref,
      };
      return consumerSaveInputV2Schema.parse({
        binding: {
          schemaVersion: "quizforge.consumer-save.v2",
          session,
          expectedStateRevision: revision,
          consumerStateAnswersSha256: await consumerAnswersSha256(answers),
          progressSha256: await consumerProgressSha256(progress),
          matchingContextSha256:
            await consumerMatchingSha256V2(matchingContext),
        },
        answers,
        progress,
        matchingContext,
      });
    }
    const first = await input(0, "any"),
      one = await call((s) => s.save(credentials, session.sessionId, first));
    assert.equal(one.kind, "applied-current");
    const second = await input(1, "female"),
      two = await call((s) =>
        s.save(
          { ...credentials, requestId: randomUUID() },
          session.sessionId,
          second,
        ),
      );
    assert.equal(two.kind, "applied-current");
    assert.notEqual(
      first.binding.matchingContextSha256,
      second.binding.matchingContextSha256,
    );
    const old = await call((s) =>
      s.resolveSave(credentials, session.sessionId, first.binding),
    );
    assert.equal(old.kind, "superseded");
    assert.deepEqual(old.binding, first.binding);
    const mixed = {
      binding: {
        schemaVersion: "quizforge.consumer-save.v1" as const,
        session,
        expectedStateRevision: 2,
        consumerStateAnswersSha256: second.binding.consumerStateAnswersSha256,
        progressSha256: second.binding.progressSha256,
      },
      answers,
      progress,
    };
    await assert.rejects(
      call((s) => s.save(credentials, session.sessionId, mixed)),
      (e: unknown) => (e as { code?: string }).code === "INVALID_REQUEST",
    );
    const foreign = await input(2, "male");
    foreign.matchingContext.policyRef = {
      ...foreign.matchingContext.policyRef,
      id: "foreign-policy",
    };
    foreign.binding.matchingContextSha256 = await consumerMatchingSha256V2(
      foreign.matchingContext,
    );
    await assert.rejects(
      call((s) => s.save(credentials, session.sessionId, foreign)),
      (e: unknown) => (e as { code?: string }).code === "INVALID_REQUEST",
    );
    const candidates = await Promise.all([input(2, "male"), input(2, "any")]);
    const concurrent = await Promise.all(
      candidates.map((candidate) =>
        call((s) =>
          s.save(
            { ...credentials, requestId: randomUUID() },
            session.sessionId,
            candidate,
          ),
        ),
      ),
    );
    assert.deepEqual(concurrent.map((r) => r.kind).sort(), [
      "applied-current",
      "superseded",
    ]);
    const winner = concurrent.find((r) => r.kind === "applied-current")!;
    assert.ok("state" in winner);
    assert.equal(winner.state.stateRevision, 3);
    assert.deepEqual(winner.state.answers, answers);
    const lost = await input(3, "female");
    let mutationCalls = 0;
    await assert.rejects(
      (async () => {
        mutationCalls++;
        await call((s) =>
          s.save(
            { ...credentials, requestId: randomUUID() },
            session.sessionId,
            lost,
          ),
        );
        throw Error("SYNTHETIC_POST_SERVICE_RESPONSE_LOSS");
      })(),
      /SYNTHETIC_POST_SERVICE_RESPONSE_LOSS/,
    );
    const resolved = await call((s) =>
      s.resolveSave(credentials, session.sessionId, lost.binding),
    );
    assert.equal(resolved.kind, "applied-current");
    assert.equal(
      resolved.bindingSha256,
      await consumerSaveBindingSha256V2(lost.binding),
    );
    assert.deepEqual(resolved.binding, lost.binding);
    assert.equal(mutationCalls, 1);
    assert.ok("state" in resolved);
    assert.equal(resolved.state.stateRevision, 4);
    const conflicting = consumerCompleteBindingV2Schema.parse({
      ...lost.binding,
      schemaVersion: "quizforge.consumer-complete.v2",
      expectedStateRevision: 4,
      matchingContextSha256: first.binding.matchingContextSha256,
      completionKey: randomUUID(),
    });
    assert.equal(
      (
        await call((s) =>
          s.resolveComplete(credentials, session.sessionId, conflicting),
        )
      ).kind,
      "state-conflict",
    );
    await assert.rejects(
      db.app.sql.begin(async (tx) => {
        await tx`UPDATE qf.consumer_session SET matching_context_sha256=NULL,state_revision=state_revision+1 WHERE id=${session.sessionId}`;
        throw Error("UNEXPECTED_UPDATE_ROLLBACK");
      }),
      (e: unknown) => (e as { code?: string }).code === "23514",
    );
    const [stored] = await db.app
      .sql`SELECT state_revision,matching_context_text,matching_context_sha256 FROM qf.consumer_session WHERE id=${session.sessionId}`;
    throw Error("UNEXPECTED_UPDATE_ROLLBACK");
    assert.equal(stored?.state_revision, 4);
    assert.equal(
      stored?.matching_context_sha256,
      lost.binding.matchingContextSha256,
    );
    console.log(
      JSON.stringify({
        evidence:
          "actual PG and consumer application services / synthetic source and implementation metadata / post-service loss simulation",
        passed: [
          "v2-null-bootstrap",
          "explicit-any",
          "preference-only-cas-preserves-answers",
          "original-save-superseded",
          "mixed-protocol-rejected",
          "foreign-policy-rejected",
          "two-writer-cas",
          "original-context-lost-response-resolution",
          "completion-context-conflict",
          "sql-null-context-rejected",
        ],
        stateRevision: stored.state_revision,
      }),
    );
  } finally {
    await db.close();
  }
}
main().catch((e) => {
  console.error(
    JSON.stringify({
      check: "qztx2-state",
      code: e.code ?? null,
      message:
        e instanceof assert.AssertionError ? "ASSERTION_FAILED" : e.message,
    }),
  );
  process.exitCode = 1;
});
