import {
  consumerAnswersSha256,
  consumerProgressSha256,
  consumerSaveBindingSha256,
  type ConsumerState,
  type ConsumerSaveInput,
} from "@/lib/consumer-contract/v1/state";
import {
  internalPlayFixture,
  testUuid,
  testMoment,
} from "@/features/product/internal-play/contracts.test-support";
import { projectConsumerEntryV1 } from "./projection";
import { consumerEntryFactsSha256 } from "@/features/fulfillment/consumer-flow/display-contract";
import type { ConsumerSessionView } from "@/features/fulfillment/consumer-flow/contracts";

/** Synthetic service facts only; no live grant/database/owner or registered runtime is asserted. */
export async function consumerHostFixtureV1() {
  const { play, content } = await internalPlayFixture();
  const projected = projectConsumerEntryV1(
    content,
    play.snapshot.parentSnapshot.target.canonicalContentSha256,
  );
  if (!projected.ok) throw Error("synthetic fixture");
  const session = {
    productId: content.product.productId,
    keyId: testUuid(20),
    sessionId: testUuid(21),
    playVersionId: play.play.id,
    playSnapshotSha256: play.play.snapshotSha256,
  };
  const initial: ConsumerState = {
    schemaVersion: "quizforge.consumer-state.v1",
    session,
    createdAt: testMoment,
    stateRevision: 0,
    answers: [],
    progress: { questionId: null },
    lastSave: null,
    consumerStateAnswersSha256: await consumerAnswersSha256([]),
    progressSha256: await consumerProgressSha256({ questionId: null }),
  };
  const view: ConsumerSessionView = {
    schemaVersion: "quizforge.consumer-session-view.v1",
    grant: {
      grantId: testUuid(25),
      session,
      issuedAt: testMoment,
      expiresAt: "2026-10-18T08:00:00.000Z",
      csrf: "A".repeat(43),
    },
    observedAt: testMoment,
    keyExpiresAt: "2026-10-25T00:00:00.000Z",
    outcome: { kind: "editable", state: initial },
  };
  const facts = {
    schemaVersion: "quizforge.consumer-entry.v1" as const,
    session,
    parent: play.snapshot.parent,
    renderer: play.snapshot.renderer,
    font: play.snapshot.parentSnapshot.font,
    mapping: play.snapshot.mapping,
    mappingSha256: play.snapshot.mappingSha256,
    entry: projected.value,
  };
  const entry = { facts, factsSha256: await consumerEntryFactsSha256(facts) };
  return { initial, session, view, entry, q: facts.entry.questions[0]! };
}
export async function consumerAppliedFixtureV1(input: ConsumerSaveInput) {
  const bindingSha256 = await consumerSaveBindingSha256(input.binding);
  const state: ConsumerState = {
    schemaVersion: "quizforge.consumer-state.v1",
    session: input.binding.session,
    createdAt: testMoment,
    stateRevision: input.binding.expectedStateRevision + 1,
    answers: input.answers,
    progress: input.progress,
    consumerStateAnswersSha256: input.binding.consumerStateAnswersSha256,
    progressSha256: input.binding.progressSha256,
    lastSave: {
      schemaVersion: "quizforge.consumer-save-receipt.v1",
      binding: input.binding,
      bindingSha256,
      appliedStateRevision: input.binding.expectedStateRevision + 1,
      savedAt: testMoment,
    },
  };
  return {
    schemaVersion: "quizforge.consumer-save-resolution.v1",
    kind: "applied-current",
    binding: input.binding,
    bindingSha256,
    state,
  };
}
