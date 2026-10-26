import "server-only";
import { z } from "zod";
import { contentScoreV3Schema } from "@/features/quizpack/content/v3-scoring-adapter";
import { matchingContextV1Schema } from "@/lib/assessment-contract/matching-v1";
import { digestV2 } from "@/features/quiz/scoring/v2/boundary";
import {
  internalPlayDetailSchema,
  verifyInternalPlayDetail,
} from "@/features/product/internal-play/contracts";
import {
  consumerAnswersSchema,
  consumerProgressSchema,
  consumerAnswersSha256,
  consumerProgressSha256,
} from "@/lib/consumer-contract/v1/state";
import {
  consumerCompleteBindingV2Schema,
  consumerCompleteBindingSha256V2,
  consumerMatchingSha256V2,
} from "@/lib/consumer-contract/v2/state";
import {
  consumerCanonicalText,
  consumerTextSha256,
  sameConsumerFact,
  withinConsumerBytes,
} from "@/lib/consumer-contract/v1/integrity";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  persistedReportDisplayV2Schema,
  persistedReportReceiptV2Schema,
  persistedReportViewV2Schema,
  persistedReportDisplaySha256V2,
  verifyPersistedReportViewV2,
} from "./view-contracts-v2";
const same = (a: unknown, b: unknown) =>
  sameConsumerFact(a, b, L.reportSnapshotBytes);
/** Sealed server facts. Historical reads verify digests and identities without scoring or composing. */
export const persistedReportSnapshotV2Schema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-report-snapshot.v2"),
    binding: consumerCompleteBindingV2Schema,
    play: internalPlayDetailSchema.refine(
      (v) => v.snapshot.schemaVersion === "quizforge.internal-play-snapshot.v2",
    ),
    answers: consumerAnswersSchema.refine((v) => v.length > 0),
    progress: consumerProgressSchema,
    matchingContext: matchingContextV1Schema,
    score: contentScoreV3Schema,
    view: persistedReportDisplayV2Schema,
  })
  .superRefine((v, ctx) => {
    const p = v.play.snapshot,
      parent = p.parentSnapshot,
      s = v.binding.session,
      score = v.score.score,
      d = v.view.display,
      b = d.body;
    const normalized = consumerAnswersSchema.safeParse(score.normalizedAnswers);
    const selected = score.decision.rankings.find((r) =>
      same(r.resultRef, score.decision.selectedResultRef),
    );
    if (
      p.schemaVersion !== "quizforge.internal-play-snapshot.v2" ||
      parent.schemaVersion !== "quizforge.internal-version-snapshot.v2" ||
      !withinConsumerBytes(v, L.reportSnapshotBytes) ||
      !same(s, v.view.session) ||
      s.productId !== p.parent.productId ||
      s.playVersionId !== v.play.play.id ||
      s.playSnapshotSha256 !== v.play.play.snapshotSha256 ||
      !same(v.view.parent, p.parent) ||
      !same(v.view.renderer, p.renderer) ||
      !same(v.view.font, parent.font) ||
      !same(v.view.mapping, p.mapping) ||
      v.view.mappingSha256 !== p.mappingSha256 ||
      !same(p.presentation, {
        presentationMode: d.presentationMode,
        exports: d.exports,
      }) ||
      v.score.canonicalContentSha256 !== parent.target.canonicalContentSha256 ||
      v.score.reportVersion !== parent.versions.reportVersion ||
      score.productId !== s.productId ||
      score.contentVersion !== parent.versions.contentVersion ||
      !same(score.engine, parent.versions.engine) ||
      score.logicHash !== parent.logicHash ||
      !same(v.matchingContext, score.matchingContext) ||
      score.matchingContextSha256 !== v.binding.matchingContextSha256 ||
      !normalized.success ||
      !same(v.answers, normalized.data) ||
      !same(
        consumerAnswersSchema.safeParse(
          b.answers.map((a) => ({
            questionId: a.questionRef.id,
            optionId: a.optionRef.id,
          })),
        ).data,
        v.answers,
      ) ||
      d.canonicalContentSha256 !== v.score.canonicalContentSha256 ||
      d.answersHash !== score.answersHash ||
      d.inputHash !== score.inputHash ||
      d.logicHash !== score.logicHash ||
      d.matchingContextSha256 !== score.matchingContextSha256 ||
      d.contentVersion !== score.contentVersion ||
      d.reportVersion !== v.score.reportVersion ||
      !same(d.selectedResultRef, score.decision.selectedResultRef) ||
      !same(d.reportTemplateRef, v.score.reportTemplateRef) ||
      !same(b.matching.selected.ref, score.decision.selectedResultRef) ||
      b.matching.selected.narrativeIndex !== selected?.narrativeIndex ||
      b.matching.status !== score.decision.status ||
      b.matching.gapTotal !== score.decision.gapTotal ||
      !same(
        b.matching.runnerUp?.ref ?? null,
        score.decision.runnerUpResultRef,
      ) ||
      b.dimensions.length !== score.dimensions.length ||
      b.dimensions.some(
        (r) =>
          !score.dimensions.some(
            (a) => same(a.dimensionRef, r.dimensionRef) && a.score === r.score,
          ),
      ) ||
      d.assets.some(
        (a) =>
          !p.resources.resources.some(
            (r) =>
              r.productId === s.productId &&
              r.resourceId === a.resourceRef.id &&
              r.resourceVersion === a.resourceRef.version &&
              r.blobSha256 === a.sha256,
          ),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Immutable v2 report facts disagree.",
      });
  });
export const persistedReportSnapshotTextV2 = (input: unknown) =>
  consumerCanonicalText(
    persistedReportSnapshotV2Schema.parse(input),
    L.reportSnapshotBytes,
  );
export const persistedReportSnapshotSha256V2 = (input: unknown) =>
  consumerTextSha256(persistedReportSnapshotTextV2(input));
export async function verifyPersistedReportSnapshotV2(input: unknown) {
  const v = persistedReportSnapshotV2Schema.parse(input),
    s = v.score.score;
  await verifyInternalPlayDetail(v.play);
  if (
    (await consumerCompleteBindingSha256V2(v.binding)) !==
      v.view.completionBindingSha256 ||
    (await consumerAnswersSha256(v.answers)) !==
      v.binding.consumerStateAnswersSha256 ||
    (await consumerProgressSha256(v.progress)) !== v.binding.progressSha256 ||
    (await consumerMatchingSha256V2(v.matchingContext)) !==
      v.binding.matchingContextSha256 ||
    digestV2("quiz-answers.v2", s.normalizedAnswers) !== s.answersHash ||
    digestV2("quiz-input.v2", {
      schemaVersion: "quiz-scoring-input.v2",
      answers: s.normalizedAnswers,
      matchingContext: v.matchingContext,
    }) !== s.inputHash
  )
    throw Error("CONSUMER_REPORT_SNAPSHOT_MISMATCH");
  return v;
}
export const persistedReportDetailV2Schema = z
  .strictObject({
    receipt: persistedReportReceiptV2Schema,
    snapshot: persistedReportSnapshotV2Schema,
  })
  .refine(
    (v) =>
      same(v.receipt.binding, v.snapshot.binding) &&
      persistedReportViewV2Schema.safeParse({
        receipt: v.receipt,
        view: v.snapshot.view,
      }).success,
  );
export async function verifyPersistedReportDetailV2(input: unknown) {
  const v = persistedReportDetailV2Schema.parse(input);
  await verifyPersistedReportSnapshotV2(v.snapshot);
  await verifyPersistedReportViewV2({
    receipt: v.receipt,
    view: v.snapshot.view,
  });
  if (
    (await persistedReportSnapshotSha256V2(v.snapshot)) !==
      v.receipt.reportSnapshotSha256 ||
    (await persistedReportDisplaySha256V2(v.snapshot.view)) !==
      v.receipt.displaySha256
  )
    throw Error("CONSUMER_REPORT_SNAPSHOT_MISMATCH");
  return v;
}
export type PersistedReportSnapshotV2 = z.infer<
  typeof persistedReportSnapshotV2Schema
>;
export type PersistedReportDetailV2 = z.infer<
  typeof persistedReportDetailV2Schema
>;
