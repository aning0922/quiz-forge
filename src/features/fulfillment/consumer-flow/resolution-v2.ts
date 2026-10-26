import "server-only";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  consumerSaveBindingSha256V2,
  type ConsumerSaveBindingV2,
  type ConsumerStateV2,
} from "@/lib/consumer-contract/v2/state";
import {
  consumerCompleteBindingSha256V2,
  type ConsumerCompleteBindingV2,
} from "@/lib/consumer-contract/v2/state";
import type { PersistedReportReceiptV2 } from "@/features/report/persisted/view-contracts-v2";
import {
  verifyConsumerSaveResolutionV2,
  verifyConsumerCompleteResolutionV2,
} from "./contracts-v2";
import { assertConsumerSessionBinding } from "./authorization";
const same = (a: unknown, b: unknown) =>
  sameConsumerFact(a, b, L.operationRequestBytes);
export async function observeConsumerSaveV2(
  binding: ConsumerSaveBindingV2,
  state: ConsumerStateV2,
  report: PersistedReportReceiptV2 | null,
) {
  assertConsumerSessionBinding(state.session, binding.session);
  if (state.stateRevision < binding.expectedStateRevision)
    throw new ConsumerError("STATE_CONFLICT");
  const exact =
    state.stateRevision === binding.expectedStateRevision + 1 &&
    state.lastSave &&
    same(state.lastSave.binding, binding);
  return verifyConsumerSaveResolutionV2(
    {
      schemaVersion: "quizforge.consumer-save-resolution.v2",
      binding,
      bindingSha256: await consumerSaveBindingSha256V2(binding),
      ...(report
        ? { kind: "completed", report }
        : {
            kind: exact
              ? "applied-current"
              : state.stateRevision === binding.expectedStateRevision
                ? "unresolved"
                : "superseded",
            state,
          }),
    },
    binding,
  );
}
export async function observeConsumerCompletionV2(
  binding: ConsumerCompleteBindingV2,
  state: ConsumerStateV2,
  report: PersistedReportReceiptV2 | null,
) {
  assertConsumerSessionBinding(state.session, binding.session);
  if (!report && state.stateRevision < binding.expectedStateRevision)
    throw new ConsumerError("STATE_CONFLICT");
  const kind = report
    ? same(report.binding, binding)
      ? "applied"
      : report.binding.completionKey === binding.completionKey
        ? "operation-conflict"
        : "completed-other"
    : state.stateRevision > binding.expectedStateRevision
      ? "superseded"
      : state.consumerStateAnswersSha256 !==
            binding.consumerStateAnswersSha256 ||
          state.progressSha256 !== binding.progressSha256 ||
          state.matchingContextSha256 !== binding.matchingContextSha256
        ? "state-conflict"
        : "unresolved";
  return verifyConsumerCompleteResolutionV2(
    {
      schemaVersion: "quizforge.consumer-complete-resolution.v2",
      binding,
      bindingSha256: await consumerCompleteBindingSha256V2(binding),
      kind,
      ...(report ? { report } : { state }),
    },
    binding,
  );
}
