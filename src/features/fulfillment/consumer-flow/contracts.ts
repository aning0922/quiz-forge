import { z } from "zod";
import {
  consumerMomentSchema as moment,
  consumerSessionRefSchema,
  consumerSha256Schema as sha,
  consumerUuidSchema as uuid,
} from "@/lib/consumer-contract/v1/primitives";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  sameConsumerFact,
  withinConsumerBytes,
} from "@/lib/consumer-contract/v1/integrity";
import {
  consumerSaveBindingSchema,
  consumerSaveBindingSha256,
  consumerStateSchema,
  verifyConsumerState,
} from "@/lib/consumer-contract/v1/state";
import {
  consumerCompleteBindingSchema,
  consumerCompleteBindingSha256,
  persistedReportReceiptSchema,
  verifyPersistedReportReceipt,
} from "@/features/report/persisted/view-contracts";
import { parseConsumerToken } from "@/lib/consumer-contract/v1/credentials";

const same = (a: unknown, b: unknown) =>
  sameConsumerFact(a, b, L.operationReceiptBytes);
const issue = (ctx: z.RefinementCtx) =>
  ctx.addIssue({
    code: "custom",
    message: "Contradictory consumer observation.",
  });
const saveObservation = {
  schemaVersion: z.literal("quizforge.consumer-save-resolution.v1"),
  binding: consumerSaveBindingSchema,
  bindingSha256: sha,
};
export const consumerSaveResolutionSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("applied-current"),
      ...saveObservation,
      state: consumerStateSchema,
    }),
    z.strictObject({
      kind: z.literal("unresolved"),
      ...saveObservation,
      state: consumerStateSchema,
    }),
    z.strictObject({
      kind: z.literal("superseded"),
      ...saveObservation,
      state: consumerStateSchema,
    }),
    z.strictObject({
      kind: z.literal("completed"),
      ...saveObservation,
      report: persistedReportReceiptSchema,
    }),
  ])
  .superRefine((v, ctx) => {
    if (!withinConsumerBytes(v, L.stateResponseBytes)) issue(ctx);
    const base = v.binding.expectedStateRevision;
    if (v.kind === "completed") {
      if (
        !same(v.binding.session, v.report.binding.session) ||
        v.report.binding.expectedStateRevision < base
      )
        issue(ctx);
      return;
    }
    if (!same(v.binding.session, v.state.session)) issue(ctx);
    const exactLast =
      v.state.stateRevision === base + 1 &&
      v.state.lastSave !== null &&
      same(v.binding, v.state.lastSave.binding) &&
      v.bindingSha256 === v.state.lastSave.bindingSha256;
    if (
      (v.kind === "applied-current" && !exactLast) ||
      (v.kind === "unresolved" && v.state.stateRevision !== base) ||
      (v.kind === "superseded" && (v.state.stateRevision <= base || exactLast))
    )
      issue(ctx);
  });

const completeObservation = {
  schemaVersion: z.literal("quizforge.consumer-complete-resolution.v1"),
  binding: consumerCompleteBindingSchema,
  bindingSha256: sha,
};
export const consumerCompleteResolutionSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("applied"),
      ...completeObservation,
      report: persistedReportReceiptSchema,
    }),
    z.strictObject({
      kind: z.literal("completed-other"),
      ...completeObservation,
      report: persistedReportReceiptSchema,
    }),
    z.strictObject({
      kind: z.literal("operation-conflict"),
      ...completeObservation,
      report: persistedReportReceiptSchema,
    }),
    z.strictObject({
      kind: z.literal("unresolved"),
      ...completeObservation,
      state: consumerStateSchema,
    }),
    z.strictObject({
      kind: z.literal("superseded"),
      ...completeObservation,
      state: consumerStateSchema,
    }),
    z.strictObject({
      kind: z.literal("state-conflict"),
      ...completeObservation,
      state: consumerStateSchema,
    }),
  ])
  .superRefine((v, ctx) => {
    if (!withinConsumerBytes(v, L.stateResponseBytes)) issue(ctx);
    if ("report" in v) {
      if (!same(v.binding.session, v.report.binding.session)) issue(ctx);
      const exact = same(v.binding, v.report.binding);
      const sameKey =
        v.binding.completionKey === v.report.binding.completionKey;
      if (
        (v.kind === "applied" &&
          (!exact || v.bindingSha256 !== v.report.bindingSha256)) ||
        (v.kind === "completed-other" && sameKey) ||
        (v.kind === "operation-conflict" && (!sameKey || exact))
      )
        issue(ctx);
    } else {
      if (!same(v.binding.session, v.state.session)) issue(ctx);
      const revision = v.state.stateRevision,
        base = v.binding.expectedStateRevision;
      const exactState =
        v.binding.consumerStateAnswersSha256 ===
          v.state.consumerStateAnswersSha256 &&
        v.binding.progressSha256 === v.state.progressSha256;
      if (
        (v.kind === "unresolved" && (revision !== base || !exactState)) ||
        (v.kind === "superseded" && revision <= base) ||
        (v.kind === "state-conflict" && (revision !== base || exactState))
      )
        issue(ctx);
    }
  });

/** These verifiers check supplied facts. Only authorized services can observe the absence of a report. */
export async function verifyConsumerSaveResolution(
  input: unknown,
  expectedInput: unknown,
) {
  const v = consumerSaveResolutionSchema.parse(input);
  if (
    !same(v.binding, consumerSaveBindingSchema.parse(expectedInput)) ||
    (await consumerSaveBindingSha256(v.binding)) !== v.bindingSha256
  )
    throw Error("CONSUMER_RESOLUTION_MISMATCH");
  if ("state" in v) await verifyConsumerState(v.state);
  else await verifyPersistedReportReceipt(v.report);
  return v;
}
export async function verifyConsumerCompleteResolution(
  input: unknown,
  expectedInput: unknown,
) {
  const v = consumerCompleteResolutionSchema.parse(input);
  if (
    !same(v.binding, consumerCompleteBindingSchema.parse(expectedInput)) ||
    (await consumerCompleteBindingSha256(v.binding)) !== v.bindingSha256
  )
    throw Error("CONSUMER_RESOLUTION_MISMATCH");
  if ("state" in v) await verifyConsumerState(v.state);
  else await verifyPersistedReportReceipt(v.report);
  return v;
}

/** Public grant facts are not bearer credentials. CSRF is sensitive and must not be logged/persisted. */
export const consumerGrantViewSchema = z
  .strictObject({
    grantId: uuid,
    session: consumerSessionRefSchema,
    issuedAt: moment,
    expiresAt: moment,
    csrf: z
      .string()
      .length(43)
      .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/),
  })
  .refine(
    (v) =>
      Date.parse(v.expiresAt) - Date.parse(v.issuedAt) ===
      L.grantLifetimeSeconds * 1000,
  );
export const consumerSessionOutcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("editable"), state: consumerStateSchema }),
  z.strictObject({ kind: z.literal("expired"), state: consumerStateSchema }),
  z.strictObject({
    kind: z.literal("completed"),
    report: persistedReportReceiptSchema,
  }),
]);
export const consumerSessionViewSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-session-view.v1"),
    grant: consumerGrantViewSchema,
    observedAt: moment,
    keyExpiresAt: moment,
    outcome: consumerSessionOutcomeSchema,
  })
  .superRefine((v, ctx) => {
    const outcomeSession =
      "state" in v.outcome
        ? v.outcome.state.session
        : v.outcome.report.binding.session;
    const now = Date.parse(v.observedAt);
    if (
      !same(v.grant.session, outcomeSession) ||
      now >= Date.parse(v.grant.expiresAt) ||
      (v.outcome.kind === "editable" && now >= Date.parse(v.keyExpiresAt)) ||
      (v.outcome.kind === "expired" && now < Date.parse(v.keyExpiresAt)) ||
      !withinConsumerBytes(v, L.stateResponseBytes)
    )
      issue(ctx);
  });
export async function verifyConsumerSessionView(
  input: unknown,
  expectedSessionId: string,
) {
  const v = consumerSessionViewSchema.parse(input);
  if (v.grant.session.sessionId !== uuid.parse(expectedSessionId))
    throw Error("CONSUMER_SESSION_MISMATCH");
  if ("state" in v.outcome) await verifyConsumerState(v.outcome.state);
  else await verifyPersistedReportReceipt(v.outcome.report);
  return v;
}

/** Exchange alone sets the HttpOnly cookie; bootstrap separately returns grant-bound CSRF. */
export const consumerExchangeInputSchema = z.strictObject({
  rawKey: z
    .string()
    .length(50)
    .refine((value) => parseConsumerToken(value, "access-key") !== null),
});
export const consumerExchangeResultSchema = z.strictObject({
  schemaVersion: z.literal("quizforge.consumer-exchange.v1"),
  session: consumerSessionRefSchema,
  destination: z.enum(["play", "report"]),
});
export type ConsumerSaveResolution = z.infer<
  typeof consumerSaveResolutionSchema
>;
export type ConsumerCompleteResolution = z.infer<
  typeof consumerCompleteResolutionSchema
>;
export type ConsumerGrantView = z.infer<typeof consumerGrantViewSchema>;
export type ConsumerSessionView = z.infer<typeof consumerSessionViewSchema>;
export type ConsumerExchangeResult = z.infer<
  typeof consumerExchangeResultSchema
>;
