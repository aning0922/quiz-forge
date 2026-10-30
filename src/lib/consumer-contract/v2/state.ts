import { z } from "zod";
import { matchingContextV1Schema } from "@/lib/assessment-contract/matching-v1";
import {
  consumerSessionRefSchema,
  consumerStateRevisionSchema,
  consumerSha256Schema as sha,
  consumerMomentSchema,
  consumerUuidSchema,
} from "../v1/primitives";
import {
  consumerAnswersSchema,
  consumerProgressSchema,
  consumerAnswersSha256,
  consumerProgressSha256,
} from "../v1/state";
import {
  consumerCanonicalText,
  consumerTextSha256,
  sameConsumerFact,
  withinConsumerBytes,
} from "../v1/integrity";
import { CONSUMER_LIMITS_V1 as L } from "../v1/limits";

export const MATCHING_CONTEXT_DOMAIN_V1 =
  "quizforge:quiz-matching-context.v1\n";
export function consumerMatchingTextV2(input: unknown) {
  return consumerCanonicalText(
    matchingContextV1Schema.nullable().parse(input),
    4096,
  );
}
export const consumerMatchingSha256V2 = (input: unknown) =>
  consumerTextSha256(
    MATCHING_CONTEXT_DOMAIN_V1 + consumerMatchingTextV2(input),
  );
export const consumerSaveBindingV2Schema = z.strictObject({
  schemaVersion: z.literal("quizforge.consumer-save.v2"),
  session: consumerSessionRefSchema,
  expectedStateRevision: consumerStateRevisionSchema,
  consumerStateAnswersSha256: sha,
  progressSha256: sha,
  matchingContextSha256: sha,
});
export const consumerSaveInputV2Schema = z
  .strictObject({
    binding: consumerSaveBindingV2Schema,
    answers: consumerAnswersSchema,
    progress: consumerProgressSchema,
    // Initial null is observable, but this protocol does not clear a chosen preference.
    matchingContext: matchingContextV1Schema,
  })
  .refine((v) => withinConsumerBytes(v, L.saveRequestBytes));
export const consumerSaveReceiptV2Schema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-save-receipt.v2"),
    binding: consumerSaveBindingV2Schema,
    bindingSha256: sha,
    appliedStateRevision: consumerStateRevisionSchema,
    savedAt: consumerMomentSchema,
  })
  .refine(
    (v) => v.appliedStateRevision === v.binding.expectedStateRevision + 1,
  );
export const consumerSaveBindingTextV2 = (input: unknown) =>
  consumerCanonicalText(
    consumerSaveBindingV2Schema.parse(input),
    L.operationRequestBytes,
  );
export const consumerSaveBindingSha256V2 = (input: unknown) =>
  consumerTextSha256(consumerSaveBindingTextV2(input));
export const consumerStateV2Schema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-state.v2"),
    session: consumerSessionRefSchema,
    createdAt: consumerMomentSchema,
    stateRevision: consumerStateRevisionSchema,
    answers: consumerAnswersSchema,
    progress: consumerProgressSchema,
    consumerStateAnswersSha256: sha,
    progressSha256: sha,
    matchingContext: matchingContextV1Schema.nullable(),
    matchingContextSha256: sha,
    lastSave: consumerSaveReceiptV2Schema.nullable(),
  })
  .refine((v) => {
    if (!withinConsumerBytes(v, L.stateResponseBytes)) return false;
    if (v.stateRevision === 0)
      return (
        v.answers.length === 0 &&
        v.progress.questionId === null &&
        v.matchingContext === null &&
        v.lastSave === null
      );
    if (v.matchingContext === null || v.lastSave === null) return false;
    const b = v.lastSave.binding;
    return (
      sameConsumerFact(b.session, v.session, L.operationRequestBytes) &&
      v.lastSave.appliedStateRevision === v.stateRevision &&
      b.consumerStateAnswersSha256 === v.consumerStateAnswersSha256 &&
      b.progressSha256 === v.progressSha256 &&
      b.matchingContextSha256 === v.matchingContextSha256
    );
  });
export async function verifyConsumerSaveInputV2(input: unknown) {
  const v = consumerSaveInputV2Schema.parse(input);
  const [answers, progress, context] = await Promise.all([
    consumerAnswersSha256(v.answers),
    consumerProgressSha256(v.progress),
    consumerMatchingSha256V2(v.matchingContext),
  ]);
  if (
    answers !== v.binding.consumerStateAnswersSha256 ||
    progress !== v.binding.progressSha256 ||
    context !== v.binding.matchingContextSha256
  )
    throw Error("CONSUMER_STATE_HASH_MISMATCH");
  return v;
}
export async function verifyConsumerStateV2(input: unknown) {
  const v = consumerStateV2Schema.parse(input);
  const [answers, progress, context] = await Promise.all([
    consumerAnswersSha256(v.answers),
    consumerProgressSha256(v.progress),
    consumerMatchingSha256V2(v.matchingContext),
  ]);
  if (
    answers !== v.consumerStateAnswersSha256 ||
    progress !== v.progressSha256 ||
    context !== v.matchingContextSha256 ||
    (v.lastSave &&
      (await consumerSaveBindingSha256V2(v.lastSave.binding)) !==
        v.lastSave.bindingSha256)
  )
    throw Error("CONSUMER_STATE_HASH_MISMATCH");
  return v;
}
export const consumerCompleteBindingV2Schema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-complete.v2"),
    session: consumerSessionRefSchema,
    expectedStateRevision: consumerStateRevisionSchema,
    consumerStateAnswersSha256: sha,
    progressSha256: sha,
    matchingContextSha256: sha,
    completionKey: consumerUuidSchema,
  })
  .refine((v) => withinConsumerBytes(v, L.operationRequestBytes));
export const consumerCompleteBindingTextV2 = (input: unknown) =>
  consumerCanonicalText(
    consumerCompleteBindingV2Schema.parse(input),
    L.operationRequestBytes,
  );
export const consumerCompleteBindingSha256V2 = (input: unknown) =>
  consumerTextSha256(consumerCompleteBindingTextV2(input));
export type ConsumerStateV2 = z.infer<typeof consumerStateV2Schema>;
export type ConsumerSaveInputV2 = z.infer<typeof consumerSaveInputV2Schema>;
export type ConsumerSaveBindingV2 = z.infer<typeof consumerSaveBindingV2Schema>;
export type ConsumerSaveReceiptV2 = z.infer<typeof consumerSaveReceiptV2Schema>;
export type ConsumerCompleteBindingV2 = z.infer<
  typeof consumerCompleteBindingV2Schema
>;
