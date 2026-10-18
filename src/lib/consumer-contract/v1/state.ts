import { z } from "zod";
import { CONSUMER_LIMITS_V1 as L } from "./limits";
import {
  consumerIdSchema,
  consumerMomentSchema,
  consumerSessionRefSchema,
  consumerSha256Schema,
  consumerStateRevisionSchema,
} from "./primitives";
import {
  consumerCanonicalText,
  consumerTextSha256,
  sameConsumerFact,
  withinConsumerBytes,
} from "./integrity";

export const consumerAnswerSchema = z.strictObject({
  questionId: consumerIdSchema,
  optionId: consumerIdSchema,
});
/** Definition ownership is checked by the server against the fixed play source. */
export const consumerAnswersSchema = z
  .array(consumerAnswerSchema)
  .max(L.questions)
  .superRefine((answers, context) => {
    if (
      new Set(answers.map((answer) => answer.questionId)).size !==
      answers.length
    )
      context.addIssue({ code: "custom", message: "Duplicate question." });
  })
  .transform((answers) =>
    [...answers].sort((left, right) =>
      left.questionId < right.questionId
        ? -1
        : left.questionId > right.questionId
          ? 1
          : 0,
    ),
  );
/** null means the cover/overview, including when existing answers are retained. */
export const consumerProgressSchema = z.strictObject({
  questionId: consumerIdSchema.nullable(),
});
export const consumerAnswersFactSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-state-answers.v1"),
    answers: consumerAnswersSchema,
  })
  .refine((value) => withinConsumerBytes(value, L.answersBytes));
export const consumerProgressFactSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-state-progress.v1"),
    progress: consumerProgressSchema,
  })
  .refine((value) => withinConsumerBytes(value, L.progressBytes));

export function consumerAnswersText(input: unknown): string {
  return consumerCanonicalText(
    consumerAnswersFactSchema.parse({
      schemaVersion: "quizforge.consumer-state-answers.v1",
      answers: input,
    }),
    L.answersBytes,
  );
}
export function consumerProgressText(input: unknown): string {
  return consumerCanonicalText(
    consumerProgressFactSchema.parse({
      schemaVersion: "quizforge.consumer-state-progress.v1",
      progress: input,
    }),
    L.progressBytes,
  );
}
export const consumerAnswersSha256 = (input: unknown) =>
  consumerTextSha256(consumerAnswersText(input));
export const consumerProgressSha256 = (input: unknown) =>
  consumerTextSha256(consumerProgressText(input));

/** Source IDs are values in the wire protocol; the display adapter never inherits prototype keys. */
export function consumerAnswersForDisplay(
  input: unknown,
): Readonly<Record<string, string>> {
  const answers = consumerAnswersSchema.parse(input);
  const mapped: Record<string, string> = Object.create(null);
  for (const answer of answers) mapped[answer.questionId] = answer.optionId;
  return Object.freeze(mapped);
}

/** The operation slot is (sessionId, expectedStateRevision), not a global UUID ledger. */
export const consumerSaveBindingSchema = z.strictObject({
  schemaVersion: z.literal("quizforge.consumer-save.v1"),
  session: consumerSessionRefSchema,
  expectedStateRevision: consumerStateRevisionSchema,
  consumerStateAnswersSha256: consumerSha256Schema,
  progressSha256: consumerSha256Schema,
});
export const consumerSaveInputSchema = z
  .strictObject({
    binding: consumerSaveBindingSchema,
    answers: consumerAnswersSchema,
    progress: consumerProgressSchema,
  })
  .refine((value) => withinConsumerBytes(value, L.saveRequestBytes));
export const consumerSaveReceiptSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-save-receipt.v1"),
    binding: consumerSaveBindingSchema,
    bindingSha256: consumerSha256Schema,
    appliedStateRevision: consumerStateRevisionSchema,
    savedAt: consumerMomentSchema,
  })
  .refine(
    (value) =>
      value.appliedStateRevision === value.binding.expectedStateRevision + 1 &&
      withinConsumerBytes(value, L.lastSaveReceiptBytes),
  );
export const consumerSaveBindingText = (input: unknown) =>
  consumerCanonicalText(
    consumerSaveBindingSchema.parse(input),
    L.operationRequestBytes,
  );
export const consumerSaveBindingSha256 = (input: unknown) =>
  consumerTextSha256(consumerSaveBindingText(input));

export const consumerStateSchema = z
  .strictObject({
    session: consumerSessionRefSchema,
    createdAt: consumerMomentSchema,
    stateRevision: consumerStateRevisionSchema,
    answers: consumerAnswersSchema,
    progress: consumerProgressSchema,
    consumerStateAnswersSha256: consumerSha256Schema,
    progressSha256: consumerSha256Schema,
    lastSave: consumerSaveReceiptSchema.nullable(),
  })
  .superRefine((state, context) => {
    const reject = () =>
      context.addIssue({
        code: "custom",
        message: "State and last receipt disagree.",
      });
    if (state.stateRevision === 0) {
      if (
        state.lastSave !== null ||
        state.answers.length !== 0 ||
        state.progress.questionId !== null
      )
        reject();
    } else {
      const last = state.lastSave;
      if (
        !last ||
        last.appliedStateRevision !== state.stateRevision ||
        !sameConsumerFact(
          last.binding.session,
          state.session,
          L.operationRequestBytes,
        ) ||
        last.binding.consumerStateAnswersSha256 !==
          state.consumerStateAnswersSha256 ||
        last.binding.progressSha256 !== state.progressSha256
      )
        reject();
    }
    if (!withinConsumerBytes(state, L.stateResponseBytes)) reject();
  });

/** Shape parsing alone is not digest verification or fixed-source answer validation. */
export async function verifyConsumerSaveInput(input: unknown) {
  const value = consumerSaveInputSchema.parse(input);
  const [answersHash, progressHash] = await Promise.all([
    consumerAnswersSha256(value.answers),
    consumerProgressSha256(value.progress),
  ]);
  if (
    answersHash !== value.binding.consumerStateAnswersSha256 ||
    progressHash !== value.binding.progressSha256
  )
    throw Error("CONSUMER_STATE_HASH_MISMATCH");
  return value;
}
export async function verifyConsumerState(input: unknown) {
  const state = consumerStateSchema.parse(input);
  const [answersHash, progressHash] = await Promise.all([
    consumerAnswersSha256(state.answers),
    consumerProgressSha256(state.progress),
  ]);
  if (
    answersHash !== state.consumerStateAnswersSha256 ||
    progressHash !== state.progressSha256 ||
    (state.lastSave &&
      (await consumerSaveBindingSha256(state.lastSave.binding)) !==
        state.lastSave.bindingSha256)
  )
    throw Error("CONSUMER_STATE_HASH_MISMATCH");
  return state;
}
export type ConsumerAnswers = z.infer<typeof consumerAnswersSchema>;
export type ConsumerProgress = z.infer<typeof consumerProgressSchema>;
export type ConsumerSaveBinding = z.infer<typeof consumerSaveBindingSchema>;
export type ConsumerSaveInput = z.infer<typeof consumerSaveInputSchema>;
export type ConsumerSaveReceipt = z.infer<typeof consumerSaveReceiptSchema>;
export type ConsumerState = z.infer<typeof consumerStateSchema>;
