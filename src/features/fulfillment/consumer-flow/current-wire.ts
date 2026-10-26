import { z } from "zod";
import {
  consumerSessionViewSchema,
  verifyConsumerSessionView,
  verifyConsumerSaveResolution,
  verifyConsumerCompleteResolution,
} from "./contracts";
import {
  consumerSessionViewV2Schema,
  verifyConsumerSessionViewV2,
  verifyConsumerSaveResolutionV2,
  verifyConsumerCompleteResolutionV2,
} from "./contracts-v2";
import {
  consumerEntryViewSchema,
  verifyConsumerEntryView,
} from "./display-contract";
import {
  consumerEntryViewV2Schema,
  verifyConsumerEntryViewV2,
} from "./display-contract-v2";
import {
  persistedReportViewSchema,
  verifyPersistedReportView,
  consumerCompleteBindingSchema,
} from "@/features/report/persisted/view-contracts";
import {
  persistedReportViewV2Schema,
  verifyPersistedReportViewV2,
} from "@/features/report/persisted/view-contracts-v2";
import {
  consumerSaveInputSchema,
  consumerSaveBindingSchema,
  verifyConsumerSaveInput,
} from "@/lib/consumer-contract/v1/state";
import {
  consumerSaveInputV2Schema,
  consumerSaveBindingV2Schema,
  consumerCompleteBindingV2Schema,
  verifyConsumerSaveInputV2,
} from "@/lib/consumer-contract/v2/state";
/** Wire shape validation is never protocol authority. The service checks the fixed play before using an input. */
export const currentSaveInputSchema = z.union([
  consumerSaveInputSchema,
  consumerSaveInputV2Schema,
]);
export const currentSaveBindingSchema = z.union([
  consumerSaveBindingSchema,
  consumerSaveBindingV2Schema,
]);
export const currentCompleteBindingSchema = z.union([
  consumerCompleteBindingSchema,
  consumerCompleteBindingV2Schema,
]);
export const currentEntryViewSchema = z.union([
  consumerEntryViewSchema,
  consumerEntryViewV2Schema,
]);
export async function verifyCurrentSaveInput(input: unknown) {
  const v = currentSaveInputSchema.parse(input);
  return "matchingContext" in v
    ? verifyConsumerSaveInputV2(v)
    : verifyConsumerSaveInput(v);
}
export async function verifyCurrentSessionViewResponse(
  input: unknown,
  id: string,
) {
  const v = z
    .union([consumerSessionViewSchema, consumerSessionViewV2Schema])
    .parse(input);
  return v.schemaVersion === "quizforge.consumer-session-view.v2"
    ? verifyConsumerSessionViewV2(v, id)
    : verifyConsumerSessionView(v, id);
}
export async function verifyCurrentEntryView(input: unknown, session: unknown) {
  const v = currentEntryViewSchema.parse(input);
  return v.facts.schemaVersion === "quizforge.consumer-entry.v2"
    ? verifyConsumerEntryViewV2(v, session)
    : verifyConsumerEntryView(v, session);
}
export async function verifyCurrentReportView(input: unknown) {
  const v = z
    .union([persistedReportViewSchema, persistedReportViewV2Schema])
    .parse(input);
  return v.receipt.schemaVersion === "quizforge.consumer-report-receipt.v2"
    ? verifyPersistedReportViewV2(v)
    : verifyPersistedReportView(v);
}
export async function verifyCurrentSaveResolution(
  input: unknown,
  expected: unknown,
) {
  const b = currentSaveBindingSchema.parse(expected);
  return b.schemaVersion === "quizforge.consumer-save.v2"
    ? verifyConsumerSaveResolutionV2(input, b)
    : verifyConsumerSaveResolution(input, b);
}
export async function verifyCurrentCompleteResolution(
  input: unknown,
  expected: unknown,
) {
  const b = currentCompleteBindingSchema.parse(expected);
  return b.schemaVersion === "quizforge.consumer-complete.v2"
    ? verifyConsumerCompleteResolutionV2(input, b)
    : verifyConsumerCompleteResolution(input, b);
}
