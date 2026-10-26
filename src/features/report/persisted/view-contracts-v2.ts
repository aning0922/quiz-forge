import { z } from "zod";
import { resultDisplaySnapshotV2Schema } from "@/lib/assessment-contract/display-v2";
import {
  consumerCompleteBindingV2Schema,
  consumerCompleteBindingSha256V2,
} from "@/lib/consumer-contract/v2/state";
import {
  consumerComponentMappingV2Schema,
  consumerMappingSha256V2,
  consumerFontIdentityV2Schema,
} from "@/lib/consumer-contract/v2/identities";
import { consumerRendererIdentitySchema } from "@/lib/consumer-contract/v1/identities";
import {
  consumerUuidSchema as uuid,
  consumerSha256Schema as sha,
  consumerMomentSchema,
  consumerSessionRefSchema,
  internalParentVersionRefSchema,
} from "@/lib/consumer-contract/v1/primitives";
import {
  consumerCanonicalText,
  consumerTextSha256,
  sameConsumerFact,
  withinConsumerBytes,
} from "@/lib/consumer-contract/v1/integrity";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";

export const persistedReportDisplayV2Schema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-report-display.v2"),
    reportId: uuid,
    session: consumerSessionRefSchema,
    completedAt: consumerMomentSchema,
    completionBindingSha256: sha,
    parent: internalParentVersionRefSchema,
    renderer: consumerRendererIdentitySchema,
    font: consumerFontIdentityV2Schema,
    mapping: consumerComponentMappingV2Schema,
    mappingSha256: sha,
    display: resultDisplaySnapshotV2Schema,
  })
  .refine(
    (v) =>
      v.parent.productId === v.session.productId &&
      v.display.selectedResultRef.productId === v.session.productId &&
      withinConsumerBytes(v, L.reportResponseBytes),
  );
export const persistedReportReceiptV2Schema = z.strictObject({
  schemaVersion: z.literal("quizforge.consumer-report-receipt.v2"),
  reportId: uuid,
  binding: consumerCompleteBindingV2Schema,
  bindingSha256: sha,
  completedAt: consumerMomentSchema,
  reportSnapshotSha256: sha,
  displaySha256: sha,
});
export const persistedReportViewV2Schema = z
  .strictObject({
    receipt: persistedReportReceiptV2Schema,
    view: persistedReportDisplayV2Schema,
  })
  .refine(
    (v) =>
      v.receipt.reportId === v.view.reportId &&
      v.receipt.completedAt === v.view.completedAt &&
      v.receipt.bindingSha256 === v.view.completionBindingSha256 &&
      sameConsumerFact(
        v.receipt.binding.session,
        v.view.session,
        L.operationRequestBytes,
      ) &&
      withinConsumerBytes(v, L.reportResponseBytes),
  );
export const persistedReportDisplayTextV2 = (input: unknown) =>
  consumerCanonicalText(
    persistedReportDisplayV2Schema.parse(input),
    L.reportResponseBytes,
  );
export const persistedReportDisplaySha256V2 = (input: unknown) =>
  consumerTextSha256(persistedReportDisplayTextV2(input));
export async function verifyPersistedReportViewV2(input: unknown) {
  const v = persistedReportViewV2Schema.parse(input),
    d = v.view.display,
    b = d.body,
    p = b.provenance;
  if (
    (await consumerCompleteBindingSha256V2(v.receipt.binding)) !==
      v.receipt.bindingSha256 ||
    (await persistedReportDisplaySha256V2(v.view)) !==
      v.receipt.displaySha256 ||
    (await consumerMappingSha256V2(v.view.mapping)) !== v.view.mappingSha256 ||
    (await consumerTextSha256(
      consumerCanonicalText(b, L.reportResponseBytes),
    )) !== d.bodySha256 ||
    p.inputHash !== d.inputHash ||
    p.answersHash !== d.answersHash ||
    p.logicHash !== d.logicHash ||
    p.matchingContextSha256 !== d.matchingContextSha256 ||
    p.canonicalContentSha256 !== d.canonicalContentSha256 ||
    p.reportVersion !== d.reportVersion ||
    !sameConsumerFact(
      p.templateRef,
      d.reportTemplateRef,
      L.operationRequestBytes,
    ) ||
    !sameConsumerFact(
      b.matching.selected.ref,
      d.selectedResultRef,
      L.operationRequestBytes,
    ) ||
    v.receipt.binding.matchingContextSha256 !== d.matchingContextSha256
  )
    throw Error("CONSUMER_REPORT_VIEW_MISMATCH");
  return v;
}
export type PersistedReportDisplayV2 = z.infer<
  typeof persistedReportDisplayV2Schema
>;
export type PersistedReportReceiptV2 = z.infer<
  typeof persistedReportReceiptV2Schema
>;
export type PersistedReportViewV2 = z.infer<typeof persistedReportViewV2Schema>;
