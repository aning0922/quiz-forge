import {
  internalPlayFixture,
  testUuid,
  testMoment,
} from "@/features/product/internal-play/contracts.test-support";
import { projectContentScoreForDisplay } from "@/features/theme/preview/result-projection";
import { contentScoreSchema } from "@/features/quizpack/content/scoring-adapter";
import {
  consumerAnswersSchema,
  consumerAnswersSha256,
  consumerProgressSha256,
} from "@/lib/consumer-contract/v1/state";
import {
  consumerCompleteBindingSha256,
  persistedReportDisplaySha256,
  type ConsumerCompleteBinding,
  type PersistedReportDisplay,
  type PersistedReportReceipt,
} from "./view-contracts";
import {
  persistedReportSnapshotSha256,
  type PersistedReportSnapshot,
} from "./snapshot-contract";

/** Actual deterministic synthetic scoring/projection; no registered runtime or durable report is asserted. */
export async function persistedReportFixture() {
  const { play, content, scored, answers } = await internalPlayFixture();
  const projection = projectContentScoreForDisplay(content, scored);
  if (!projection.ok) throw Error("SYNTHETIC_FIXTURE_INVALID");
  const progress = { questionId: null };
  const binding: ConsumerCompleteBinding = {
    schemaVersion: "quizforge.consumer-complete.v1",
    session: {
      productId: play.snapshot.parent.productId,
      playVersionId: play.play.id,
      playSnapshotSha256: play.play.snapshotSha256,
      keyId: testUuid(20),
      sessionId: testUuid(21),
    },
    expectedStateRevision: 1,
    consumerStateAnswersSha256: await consumerAnswersSha256(answers),
    progressSha256: await consumerProgressSha256(progress),
    completionKey: testUuid(22),
  };
  const bindingSha256 = await consumerCompleteBindingSha256(binding);
  const view: PersistedReportDisplay = {
    schemaVersion: "quizforge.consumer-report-display.v1",
    reportId: testUuid(23),
    session: binding.session,
    completedAt: testMoment,
    completionBindingSha256: bindingSha256,
    parent: play.snapshot.parent,
    renderer: play.snapshot.renderer,
    font: play.snapshot.parentSnapshot.font,
    mapping: play.snapshot.mapping,
    mappingSha256: play.snapshot.mappingSha256,
    display: projection.value,
  };
  const snapshot: PersistedReportSnapshot = {
    schemaVersion: "quizforge.consumer-report-snapshot.v1",
    binding,
    play,
    answers: consumerAnswersSchema.parse(answers),
    progress,
    score: contentScoreSchema.parse(scored),
    view,
  };
  const receipt: PersistedReportReceipt = {
    schemaVersion: "quizforge.consumer-report-receipt.v1",
    reportId: view.reportId,
    binding,
    bindingSha256,
    completedAt: view.completedAt,
    reportSnapshotSha256: await persistedReportSnapshotSha256(snapshot),
    displaySha256: await persistedReportDisplaySha256(view),
  };
  return { snapshot, receipt, view };
}
