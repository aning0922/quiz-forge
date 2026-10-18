import "server-only";
import { z } from "zod";
import { contentScoreSchema } from "@/features/quizpack/content/scoring-adapter";
import { displayHalfUp } from "@/features/quiz/scoring/rational";
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
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  consumerCanonicalText,
  consumerTextSha256,
  sameConsumerFact,
  withinConsumerBytes,
} from "@/lib/consumer-contract/v1/integrity";
import {
  persistedReportViewSchema,
  persistedReportDisplaySchema,
  persistedReportReceiptSchema,
  consumerCompleteBindingSchema,
  consumerCompleteBindingSha256,
  persistedReportDisplaySha256,
} from "./view-contracts";

/** Complete immutable server fact. Never pass this Schema/module or full score to a client component. */
export const persistedReportSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-report-snapshot.v1"),
    binding: consumerCompleteBindingSchema,
    play: internalPlayDetailSchema,
    answers: consumerAnswersSchema.refine((v) => v.length > 0),
    progress: consumerProgressSchema,
    score: contentScoreSchema,
    view: persistedReportDisplaySchema,
  })
  .superRefine((v, ctx) => {
    const parent = v.play.snapshot.parentSnapshot;
    const session = v.binding.session;
    const score = v.score.score;
    const display = v.view.display;
    const same = (a: unknown, b: unknown) =>
      sameConsumerFact(a, b, L.reportSnapshotBytes);
    const normalized = consumerAnswersSchema.safeParse(score.normalizedAnswers);
    if (
      !withinConsumerBytes(v, L.reportSnapshotBytes) ||
      !same(session, v.view.session) ||
      session.productId !== v.play.snapshot.parent.productId ||
      session.playVersionId !== v.play.play.id ||
      session.playSnapshotSha256 !== v.play.play.snapshotSha256 ||
      !same(v.view.parent, v.play.snapshot.parent) ||
      !same(v.view.renderer, v.play.snapshot.renderer) ||
      !same(v.view.font, parent.font) ||
      !same(v.view.mapping, v.play.snapshot.mapping) ||
      v.view.mappingSha256 !== v.play.snapshot.mappingSha256 ||
      v.score.contentSchemaVersion !== parent.contentSchemaVersion ||
      v.score.canonicalContentSha256 !== parent.target.canonicalContentSha256 ||
      v.score.contentVersion !== parent.versions.contentVersion ||
      v.score.reportVersion !== parent.versions.reportVersion ||
      score.productId !== session.productId ||
      score.contentVersion !== parent.versions.contentVersion ||
      !same(score.engine, parent.versions.engine) ||
      score.logicHash !== parent.logicHash ||
      display.answersHash !== score.answersHash ||
      display.logicHash !== score.logicHash ||
      display.contentSchemaVersion !== v.score.contentSchemaVersion ||
      display.contentVersion !== v.score.contentVersion ||
      display.reportVersion !== v.score.reportVersion ||
      !same(display.selectedResultRef, score.decision.selectedResultRef) ||
      !same(display.reportTemplateRef, v.score.reportTemplateRef) ||
      !normalized.success ||
      !same(v.answers, normalized.data) ||
      display.dimensions.length !== score.dimensions.length ||
      display.dimensions.some((dimension) => {
        const actual = score.dimensions.find((s) =>
          same(s.dimensionRef, dimension.dimensionRef),
        );
        if (!actual) return true;
        try {
          return (
            dimension.normalizedText !==
            displayHalfUp(
              BigInt(actual.normalized.numerator),
              BigInt(actual.normalized.denominator),
            )
          );
        } catch {
          return true;
        }
      }) ||
      !v.play.snapshot.resources.resources.some(
        (r) =>
          r.productId === session.productId &&
          r.resourceId === display.result.portrait.resourceRef.id &&
          r.resourceVersion === display.result.portrait.resourceRef.version &&
          r.blobSha256 === display.result.portrait.sha256,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Immutable report facts disagree.",
      });
  });
export const persistedReportSnapshotText = (input: unknown) =>
  consumerCanonicalText(
    persistedReportSnapshotSchema.parse(input),
    L.reportSnapshotBytes,
  );
export const persistedReportSnapshotSha256 = (input: unknown) =>
  consumerTextSha256(persistedReportSnapshotText(input));

/** Consistency/digest verification, not a replacement for trusted execution or fixed-source prose validation. */
export async function verifyPersistedReportSnapshot(input: unknown) {
  const value = persistedReportSnapshotSchema.parse(input);
  await verifyInternalPlayDetail(value.play);
  if (
    (await consumerCompleteBindingSha256(value.binding)) !==
      value.view.completionBindingSha256 ||
    (await consumerAnswersSha256(value.answers)) !==
      value.binding.consumerStateAnswersSha256 ||
    (await consumerProgressSha256(value.progress)) !==
      value.binding.progressSha256
  )
    throw Error("CONSUMER_REPORT_SNAPSHOT_MISMATCH");
  return value;
}
export const persistedReportDetailSchema = z
  .strictObject({
    receipt: persistedReportReceiptSchema,
    snapshot: persistedReportSnapshotSchema,
  })
  .refine(
    (v) =>
      sameConsumerFact(
        v.receipt.binding,
        v.snapshot.binding,
        L.operationRequestBytes,
      ) &&
      persistedReportViewSchema.safeParse({
        receipt: v.receipt,
        view: v.snapshot.view,
      }).success,
  );
export async function verifyPersistedReportDetail(input: unknown) {
  const value = persistedReportDetailSchema.parse(input);
  await verifyPersistedReportSnapshot(value.snapshot);
  if (
    (await persistedReportSnapshotSha256(value.snapshot)) !==
      value.receipt.reportSnapshotSha256 ||
    (await persistedReportDisplaySha256(value.snapshot.view)) !==
      value.receipt.displaySha256
  )
    throw Error("CONSUMER_REPORT_SNAPSHOT_MISMATCH");
  return value;
}
export type PersistedReportSnapshot = z.infer<
  typeof persistedReportSnapshotSchema
>;
export type PersistedReportDetail = z.infer<typeof persistedReportDetailSchema>;
