import "server-only";
import type { ConsumerSaveBinding } from "@/lib/consumer-contract/v1/state";
import type {
  ConsumerSaveBindingV2,
  ConsumerCompleteBindingV2,
} from "@/lib/consumer-contract/v2/state";
import type {
  ConsumerCompleteBinding,
  PersistedReportReceipt,
} from "@/features/report/persisted/view-contracts";
import type { PersistedReportReceiptV2 } from "@/features/report/persisted/view-contracts-v2";
import type { ConsumerAuthority } from "./authorization";
import { assertConsumerSessionBinding } from "./authorization";
import {
  observeCurrentSave,
  observeCurrentCompletion,
} from "./current-contracts";
import {
  consumerPolicyBindingSha256,
  verifyConsumerPolicyResolution,
} from "./policy-contracts";

type Report = PersistedReportReceipt | PersistedReportReceiptV2 | null;
type Binding =
  | ConsumerSaveBinding
  | ConsumerSaveBindingV2
  | ConsumerCompleteBinding
  | ConsumerCompleteBindingV2;
export function consumerPolicyOutcome(a: ConsumerAuthority, report: Report) {
  const session = a.state.session;
  if (report && report.binding.session.sessionId !== session.sessionId)
    return {
      kind: "entitlement-completed" as const,
      session,
      requiresReexchange: true as const,
    };
  if (!report && !a.policy.current && a.policy.current_generation !== null)
    return {
      kind: "version-superseded" as const,
      session,
      attemptGeneration: a.policy.attempt_generation,
      currentGeneration: a.policy.current_generation,
      requiresReexchange: true as const,
    };
  return null;
}
async function terminal(
  binding: Binding,
  outcome: NonNullable<ReturnType<typeof consumerPolicyOutcome>>,
) {
  return verifyConsumerPolicyResolution(
    {
      schemaVersion: "quizforge.consumer-policy-resolution.v1",
      binding,
      bindingSha256: await consumerPolicyBindingSha256(binding),
      kind: outcome.kind,
      outcome,
    },
    binding,
  );
}
export async function observePolicySave(
  binding: ConsumerSaveBinding | ConsumerSaveBindingV2,
  a: ConsumerAuthority,
  report: Report,
  locked = false,
) {
  assertConsumerSessionBinding(a.state.session, binding.session);
  const sameReport =
    report?.binding.session.sessionId === a.state.session.sessionId
      ? report
      : null;
  const original = await observeCurrentSave(binding, a.state, null);
  if (original.kind === "applied-current") return original;
  const policy = consumerPolicyOutcome(a, report);
  if (
    policy?.kind === "entitlement-completed" ||
    (locked && original.kind === "unresolved" && policy)
  )
    return terminal(binding, policy);
  return sameReport
    ? observeCurrentSave(binding, a.state, sameReport)
    : original;
}
export async function observePolicyCompletion(
  binding: ConsumerCompleteBinding | ConsumerCompleteBindingV2,
  a: ConsumerAuthority,
  report: Report,
  locked = false,
) {
  assertConsumerSessionBinding(a.state.session, binding.session);
  const sameReport =
    report?.binding.session.sessionId === a.state.session.sessionId
      ? report
      : null;
  const original = await observeCurrentCompletion(binding, a.state, sameReport);
  const policy = consumerPolicyOutcome(a, report);
  if (
    policy?.kind === "entitlement-completed" ||
    (locked && original.kind === "unresolved" && policy)
  )
    return terminal(binding, policy);
  return original;
}
