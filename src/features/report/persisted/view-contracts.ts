import { z } from "zod";
import { resultDisplaySnapshotV1Schema } from "@/lib/assessment-contract/display-v1";
import {
  consumerMomentSchema as moment,
  consumerSessionRefSchema,
  consumerSha256Schema as sha,
  consumerStateRevisionSchema,
  consumerUuidSchema as uuid,
  internalParentVersionRefSchema,
} from "@/lib/consumer-contract/v1/primitives";
import {
  consumerRendererIdentitySchema,
  consumerFontIdentitySchema,
  consumerComponentMappingSchema,
  consumerMappingSha256,
} from "@/lib/consumer-contract/v1/identities";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  consumerCanonicalText,
  consumerTextSha256,
  sameConsumerFact,
  withinConsumerBytes,
} from "@/lib/consumer-contract/v1/integrity";

/** Exact original completion target. There is no client-supplied score or report body. */
export const consumerCompleteBindingSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-complete.v1"),
    session: consumerSessionRefSchema,
    expectedStateRevision: consumerStateRevisionSchema,
    consumerStateAnswersSha256: sha,
    progressSha256: sha,
    completionKey: uuid,
  })
  .refine((v) => withinConsumerBytes(v, L.operationRequestBytes));
export const consumerCompleteBindingText = (input: unknown) =>
  consumerCanonicalText(
    consumerCompleteBindingSchema.parse(input),
    L.operationRequestBytes,
  );
export const consumerCompleteBindingSha256 = (input: unknown) =>
  consumerTextSha256(consumerCompleteBindingText(input));

/** Only the selected display, never scoring weights, unselected reports, or a full source. */
export const persistedReportDisplaySchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-report-display.v1"),
    reportId: uuid,
    session: consumerSessionRefSchema,
    completedAt: moment,
    completionBindingSha256: sha,
    parent: internalParentVersionRefSchema,
    renderer: consumerRendererIdentitySchema,
    font: consumerFontIdentitySchema,
    mapping: consumerComponentMappingSchema,
    mappingSha256: sha,
    display: resultDisplaySnapshotV1Schema,
  })
  .refine(
    (v) =>
      v.parent.productId === v.session.productId &&
      v.display.selectedResultRef.productId === v.session.productId &&
      withinConsumerBytes(v, L.reportResponseBytes),
  );
export const persistedReportDisplayText = (input: unknown) =>
  consumerCanonicalText(
    persistedReportDisplaySchema.parse(input),
    L.reportResponseBytes,
  );
export const persistedReportDisplaySha256 = (input: unknown) =>
  consumerTextSha256(persistedReportDisplayText(input));

/** reportSnapshotSha256 identifies server-only bytes; a browser cannot verify bytes it did not receive. */
export const persistedReportReceiptSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-report-receipt.v1"),
    reportId: uuid,
    binding: consumerCompleteBindingSchema,
    bindingSha256: sha,
    completedAt: moment,
    reportSnapshotSha256: sha,
    displaySha256: sha,
  })
  .refine((v) => withinConsumerBytes(v, L.operationReceiptBytes));
export const persistedReportViewSchema = z
  .strictObject({
    receipt: persistedReportReceiptSchema,
    view: persistedReportDisplaySchema,
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
export async function verifyPersistedReportReceipt(input: unknown) {
  const value = persistedReportReceiptSchema.parse(input);
  if (
    (await consumerCompleteBindingSha256(value.binding)) !== value.bindingSha256
  )
    throw Error("CONSUMER_REPORT_VIEW_MISMATCH");
  return value;
}
/** Verifies the received display SHA and binding only; it does not authenticate a server or full report SHA. */
export async function verifyPersistedReportView(input: unknown) {
  const value = persistedReportViewSchema.parse(input);
  await verifyPersistedReportReceipt(value.receipt);
  if (
    (await persistedReportDisplaySha256(value.view)) !==
      value.receipt.displaySha256 ||
    (await consumerMappingSha256(value.view.mapping)) !==
      value.view.mappingSha256
  )
    throw Error("CONSUMER_REPORT_VIEW_MISMATCH");
  return value;
}
export type ConsumerCompleteBinding = z.infer<
  typeof consumerCompleteBindingSchema
>;
export type PersistedReportDisplay = z.infer<
  typeof persistedReportDisplaySchema
>;
export type PersistedReportReceipt = z.infer<
  typeof persistedReportReceiptSchema
>;
export type PersistedReportView = z.infer<typeof persistedReportViewSchema>;
