import "server-only";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  consumerSaveBindingSha256,
  type ConsumerSaveBinding,
  type ConsumerState,
} from "@/lib/consumer-contract/v1/state";
import {
  consumerCompleteBindingSha256,
  type ConsumerCompleteBinding,
  type PersistedReportReceipt,
} from "@/features/report/persisted/view-contracts";
import {
  verifyConsumerSaveResolution,
  verifyConsumerCompleteResolution,
} from "./contracts";
import { assertConsumerSessionBinding } from "./authorization";
const same = (a: unknown, b: unknown) =>
  sameConsumerFact(a, b, L.operationRequestBytes);
export async function observeConsumerSave(
  binding: ConsumerSaveBinding,
  state: ConsumerState,
  report: PersistedReportReceipt | null,
) {
  assertConsumerSessionBinding(state.session, binding.session);
  if (state.stateRevision < binding.expectedStateRevision)
    throw new ConsumerError("STATE_CONFLICT");
  const exact =
    state.stateRevision === binding.expectedStateRevision + 1 &&
    state.lastSave &&
    same(state.lastSave.binding, binding);
  return verifyConsumerSaveResolution(
    {
      schemaVersion: "quizforge.consumer-save-resolution.v1",
      binding,
      bindingSha256: await consumerSaveBindingSha256(binding),
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
export async function observeConsumerCompletion(
  binding: ConsumerCompleteBinding,
  state: ConsumerState,
  report: PersistedReportReceipt | null,
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
          state.progressSha256 !== binding.progressSha256
        ? "state-conflict"
        : "unresolved";
  return verifyConsumerCompleteResolution(
    {
      schemaVersion: "quizforge.consumer-complete-resolution.v1",
      binding,
      bindingSha256: await consumerCompleteBindingSha256(binding),
      kind,
      ...(report ? { report } : { state }),
    },
    binding,
  );
}
