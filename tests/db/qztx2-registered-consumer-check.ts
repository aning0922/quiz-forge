import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestDatabase } from "./p2a-fixture";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import type { InternalPlayDetail } from "@/features/product/internal-play/contracts";
import type { QuizPackContentV3 } from "@/features/quizpack/content/v3";
import { createStudioRequestBudget } from "@/lib/http-security/request-budget";
import { createConsumerRequestOwner } from "@/features/fulfillment/consumer-flow/request-owner";
import { createConsumerFlowService } from "@/features/fulfillment/consumer-flow/service";
import { createAccessKeyService } from "@/features/fulfillment/access/service";
import {
  createConsumerToken,
  digestConsumerToken,
} from "@/lib/consumer-contract/v1/credentials";
import {
  consumerAnswersSchema,
  consumerAnswersSha256,
  consumerProgressSha256,
} from "@/lib/consumer-contract/v1/state";
import {
  consumerMatchingSha256V2,
  consumerSaveInputV2Schema,
  consumerCompleteBindingV2Schema,
} from "@/lib/consumer-contract/v2/state";
import {
  consumerSessionViewV2Schema,
  consumerSaveResolutionV2Schema,
  consumerCompleteResolutionV2Schema,
} from "@/features/fulfillment/consumer-flow/contracts-v2";
import { consumerEntryViewV2Schema } from "@/features/fulfillment/consumer-flow/display-contract-v2";
import { verifyPersistedReportViewV2 } from "@/features/report/persisted/view-contracts-v2";

/**
 * Additive actual-service continuation for a caller's already imported/sealed registered synthetic play.
 * The caller owns and separately proves native import/review/play creation; this function never fabricates them.
 * It retains its Key/session/report, never resets a database, and returns only non-sensitive case names.
 */
export async function checkRegisteredV2Consumer(
  db: TestDatabase,
  operator: StudioWriteCredentials,
  play: InternalPlayDetail,
  content: QuizPackContentV3,
) {
  assert.ok(db.config.purpose === "test" || db.config.purpose === "ci");
  assert.equal(content.bindings.kind, "synthetic");
  assert.equal(content.core.scoringDefinition.productId, "synthetic-d2");
  assert.equal(play.play.binding.parent.productId, "synthetic-d2");
  assert.equal(
    play.snapshot.schemaVersion,
    "quizforge.internal-play-snapshot.v2",
  );
  const cases: string[] = [];
  const invoke = async <T>(
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
  const raw = createConsumerToken("access-key"),
    credentialDigest = await digestConsumerToken(raw, "access-key");
  assert.ok(credentialDigest);
  const issued = await invoke((owner) =>
    createAccessKeyService(owner).issue(
      { ...operator, requestId: randomUUID() },
      "synthetic-d2",
      {
        schemaVersion: "quizforge.access-key-issue.v1",
        operationKey: randomUUID(),
        keyId: randomUUID(),
        play: {
          productId: "synthetic-d2",
          playVersionId: play.play.id,
          playSnapshotSha256: play.play.snapshotSha256,
        },
        credentialDigest,
        validForSeconds: 3600,
      },
    ),
  );
  assert.equal(issued.created, true);
  cases.push("registered-play-actual-key-issue");
  const exchanged = await invoke((o) =>
      createConsumerFlowService(o).exchange(raw),
    ),
    sessionId = exchanged.result.session.sessionId,
    read = { grantToken: exchanged.cookieGrantToken };
  const initial = consumerSessionViewV2Schema.parse(
    await invoke((o) =>
      createConsumerFlowService(o).readSession(read, sessionId),
    ),
  );
  assert.equal(initial.outcome.kind, "editable");
  if (initial.outcome.kind !== "editable") throw Error("D2_EDITABLE_REQUIRED");
  let state = initial.outcome.state;
  const write = {
    ...read,
    csrfToken: initial.grant.csrf,
    requestId: randomUUID(),
  };
  assert.equal(state.matchingContext, null);
  const entry = consumerEntryViewV2Schema.parse(
    await invoke((o) =>
      createConsumerFlowService(o).readEntry(read, sessionId),
    ),
  );
  assert.equal(entry.facts.entry.questions.length, 24);
  cases.push("registered-entry-actual-resource-io");
  const select = (ref: { id: string; version: string }) => {
    const resource = content.bindings.resources.find(
      (r) => r.id === ref.id && r.version === ref.version,
    );
    assert.ok(resource);
    return {
      resourceId: resource.id,
      resourceVersion: resource.version,
      sha256: resource.sha256,
    };
  };
  await assert.rejects(
    invoke((o) =>
      createConsumerFlowService(o).readResource(
        read,
        sessionId,
        select(content.bindings.slots.characters[0]!.reveal),
      ),
    ),
    /ACCESS_DENIED/,
  );
  cases.push("pre-completion-character-resource-denied");
  const matchingContext = {
    schemaVersion: "quiz-matching-context.v1" as const,
    preference: "any" as const,
    policyRef: entry.facts.entry.matchingPolicyRef,
  };
  const save = async (
    answers: typeof state.answers,
    questionId: string | null,
    observeOnly = false,
  ) => {
    const progress = { questionId },
      input = consumerSaveInputV2Schema.parse({
        binding: {
          schemaVersion: "quizforge.consumer-save.v2",
          session: state.session,
          expectedStateRevision: state.stateRevision,
          consumerStateAnswersSha256: await consumerAnswersSha256(answers),
          progressSha256: await consumerProgressSha256(progress),
          matchingContextSha256:
            await consumerMatchingSha256V2(matchingContext),
        },
        answers,
        progress,
        matchingContext,
      });
    // Deliberately discard a successful response once; recovery observes the original tuple and never resubmits.
    const saved = await invoke((o) =>
      createConsumerFlowService(o).save(
        { ...write, requestId: randomUUID() },
        sessionId,
        input,
      ),
    );
    const result = consumerSaveResolutionV2Schema.parse(
      observeOnly
        ? await invoke((o) =>
            createConsumerFlowService(o).resolveSave(
              write,
              sessionId,
              input.binding,
            ),
          )
        : saved,
    );
    assert.equal(result.kind, "applied-current");
    if (result.kind !== "applied-current")
      throw Error("D2_APPLIED_SAVE_REQUIRED");
    assert.equal(result.state.stateRevision, state.stateRevision + 1);
    state = result.state;
  };
  await save([], entry.facts.entry.questions[0]!.ref.id, true);
  assert.equal(state.answers.length, 0);
  cases.push("preference-only-save-original-tuple-resolution");
  const answers = consumerAnswersSchema.parse(
    content.bindings.witnesses.entries[0]!.answers,
  );
  for (let count = 1; count <= answers.length; count++)
    await save(answers.slice(0, count), answers[count]?.questionId ?? null);
  assert.equal(state.answers.length, 24);
  assert.equal(state.stateRevision, 25);
  cases.push("24-serial-question-cas-saves");
  const binding = consumerCompleteBindingV2Schema.parse({
    schemaVersion: "quizforge.consumer-complete.v2",
    session: state.session,
    expectedStateRevision: state.stateRevision,
    consumerStateAnswersSha256: state.consumerStateAnswersSha256,
    progressSha256: state.progressSha256,
    matchingContextSha256: state.matchingContextSha256,
    completionKey: randomUUID(),
  });
  await invoke((o) =>
    createConsumerFlowService(o).complete(write, sessionId, binding),
  );
  const resolved = consumerCompleteResolutionV2Schema.parse(
    await invoke((o) =>
      createConsumerFlowService(o).resolveComplete(write, sessionId, binding),
    ),
  );
  assert.equal(resolved.kind, "applied");
  if (resolved.kind !== "applied") throw Error("D2_APPLIED_COMPLETE_REQUIRED");
  const report = await verifyPersistedReportViewV2(
    await invoke((o) =>
      createConsumerFlowService(o).readReport(read, sessionId),
    ),
  );
  assert.equal(report.view.display.body.answers.length, 24);
  assert.equal(report.view.display.body.volumes.length, 6);
  assert.equal(
    report.receipt.reportSnapshotSha256,
    resolved.report.reportSnapshotSha256,
  );
  cases.push("registered-completion-actual-io-six-volume-snapshot");
  const replay = consumerCompleteResolutionV2Schema.parse(
    await invoke((o) =>
      createConsumerFlowService(o).complete(write, sessionId, binding),
    ),
  );
  assert.equal(replay.kind, "applied");
  const changed = {
    ...binding,
    matchingContextSha256: await consumerMatchingSha256V2({
      ...matchingContext,
      preference: "female",
    }),
  };
  assert.equal(
    (
      await invoke((o) =>
        createConsumerFlowService(o).complete(write, sessionId, changed),
      )
    ).kind,
    "operation-conflict",
  );
  cases.push("completion-original-tuple-resolution-and-conflict");
  const foreign = content.bindings.slots.characters.find(
    (c) => c.resultRef.id !== report.view.display.selectedResultRef.id,
  );
  assert.ok(foreign);
  await assert.rejects(
    invoke((o) =>
      createConsumerFlowService(o).readResource(
        read,
        sessionId,
        select(foreign.reveal),
      ),
    ),
    /ACCESS_DENIED/,
  );
  cases.push("other-character-resource-denied-after-completion");
  const returned = await invoke((o) =>
    createConsumerFlowService(o).exchange(raw),
  );
  const again = consumerSessionViewV2Schema.parse(
    await invoke((o) =>
      createConsumerFlowService(o).readSession(
        { grantToken: returned.cookieGrantToken },
        sessionId,
      ),
    ),
  );
  assert.equal(again.outcome.kind, "completed");
  const reread = await verifyPersistedReportViewV2(
    await invoke((o) =>
      createConsumerFlowService(o).readReport(
        { grantToken: returned.cookieGrantToken },
        sessionId,
      ),
    ),
  );
  assert.equal(
    reread.receipt.reportSnapshotSha256,
    report.receipt.reportSnapshotSha256,
  );
  assert.deepEqual(reread.view, report.view);
  cases.push("original-key-read-only-same-immutable-report");
  return {
    evidence: "actual-registered-consumer-service / synthetic-content",
    cases,
  };
}
