import { z } from "zod";
import {
  consumerMomentSchema as moment,
  consumerSha256Schema as sha,
  consumerUuidSchema as uuid,
} from "@/lib/consumer-contract/v1/primitives";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  sameConsumerFact,
  withinConsumerBytes,
} from "@/lib/consumer-contract/v1/integrity";
import {
  consumerCompleteBindingV2Schema,
  consumerCompleteBindingSha256V2,
  consumerSaveBindingV2Schema,
  consumerSaveBindingSha256V2,
  consumerStateV2Schema,
  verifyConsumerStateV2,
} from "@/lib/consumer-contract/v2/state";
import {
  persistedReportReceiptV2Schema,
  verifyPersistedReportReceiptV2,
} from "@/features/report/persisted/view-contracts-v2";

const same = (a: unknown, b: unknown) =>
  sameConsumerFact(a, b, L.operationReceiptBytes);
const issue = (ctx: z.RefinementCtx) =>
  ctx.addIssue({
    code: "custom",
    message: "Contradictory consumer observation.",
  });
const saveObservation = {
  schemaVersion: z.literal("quizforge.consumer-save-resolution.v2"),
  binding: consumerSaveBindingV2Schema,
  bindingSha256: sha,
};
export const consumerSaveResolutionV2Schema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("applied-current"),
      ...saveObservation,
      state: consumerStateV2Schema,
    }),
    z.strictObject({
      kind: z.literal("unresolved"),
      ...saveObservation,
      state: consumerStateV2Schema,
    }),
    z.strictObject({
      kind: z.literal("superseded"),
      ...saveObservation,
      state: consumerStateV2Schema,
    }),
    z.strictObject({
      kind: z.literal("completed"),
      ...saveObservation,
      report: persistedReportReceiptV2Schema,
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
  schemaVersion: z.literal("quizforge.consumer-complete-resolution.v2"),
  binding: consumerCompleteBindingV2Schema,
  bindingSha256: sha,
};
export const consumerCompleteResolutionV2Schema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("applied"),
      ...completeObservation,
      report: persistedReportReceiptV2Schema,
    }),
    z.strictObject({
      kind: z.literal("completed-other"),
      ...completeObservation,
      report: persistedReportReceiptV2Schema,
    }),
    z.strictObject({
      kind: z.literal("operation-conflict"),
      ...completeObservation,
      report: persistedReportReceiptV2Schema,
    }),
    z.strictObject({
      kind: z.literal("unresolved"),
      ...completeObservation,
      state: consumerStateV2Schema,
    }),
    z.strictObject({
      kind: z.literal("superseded"),
      ...completeObservation,
      state: consumerStateV2Schema,
    }),
    z.strictObject({
      kind: z.literal("state-conflict"),
      ...completeObservation,
      state: consumerStateV2Schema,
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
        v.binding.progressSha256 === v.state.progressSha256 &&
        v.binding.matchingContextSha256 === v.state.matchingContextSha256;
      if (
        (v.kind === "unresolved" && (revision !== base || !exactState)) ||
        (v.kind === "superseded" && revision <= base) ||
        (v.kind === "state-conflict" && (revision !== base || exactState))
      )
        issue(ctx);
    }
  });

/** These verifiers check supplied facts. Only authorized services can observe the absence of a report. */
export async function verifyConsumerSaveResolutionV2(
  input: unknown,
  expectedInput: unknown,
) {
  const v = consumerSaveResolutionV2Schema.parse(input);
  if (
    !same(v.binding, consumerSaveBindingV2Schema.parse(expectedInput)) ||
    (await consumerSaveBindingSha256V2(v.binding)) !== v.bindingSha256
  )
    throw Error("CONSUMER_RESOLUTION_MISMATCH");
  if ("state" in v) await verifyConsumerStateV2(v.state);
  else await verifyPersistedReportReceiptV2(v.report);
  return v;
}
export async function verifyConsumerCompleteResolutionV2(
  input: unknown,
  expectedInput: unknown,
) {
  const v = consumerCompleteResolutionV2Schema.parse(input);
  if (
    !same(v.binding, consumerCompleteBindingV2Schema.parse(expectedInput)) ||
    (await consumerCompleteBindingSha256V2(v.binding)) !== v.bindingSha256
  )
    throw Error("CONSUMER_RESOLUTION_MISMATCH");
  if ("state" in v) await verifyConsumerStateV2(v.state);
  else await verifyPersistedReportReceiptV2(v.report);
  return v;
}

import { consumerGrantViewSchema } from "./contracts";
export const consumerSessionOutcomeV2Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("editable"), state: consumerStateV2Schema }),
  z.strictObject({ kind: z.literal("expired"), state: consumerStateV2Schema }),
  z.strictObject({
    kind: z.literal("completed"),
    report: persistedReportReceiptV2Schema,
  }),
]);
export const consumerSessionViewV2Schema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-session-view.v2"),
    grant: consumerGrantViewSchema,
    observedAt: moment,
    keyExpiresAt: moment,
    outcome: consumerSessionOutcomeV2Schema,
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
export async function verifyConsumerSessionViewV2(
  input: unknown,
  expectedSessionId: string,
) {
  const v = consumerSessionViewV2Schema.parse(input);
  if (v.grant.session.sessionId !== uuid.parse(expectedSessionId))
    throw Error("CONSUMER_SESSION_MISMATCH");
  if ("state" in v.outcome) await verifyConsumerStateV2(v.outcome.state);
  else await verifyPersistedReportReceiptV2(v.outcome.report);
  return v;
}

export type ConsumerSaveResolutionV2 = z.infer<
  typeof consumerSaveResolutionV2Schema
>;
export type ConsumerCompleteResolutionV2 = z.infer<
  typeof consumerCompleteResolutionV2Schema
>;
export type ConsumerSessionViewV2 = z.infer<typeof consumerSessionViewV2Schema>;
