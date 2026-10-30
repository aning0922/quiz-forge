import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import {
  type ConsumerSaveBinding,
  type ConsumerState,
} from "@/lib/consumer-contract/v1/state";
import {
  type ConsumerCompleteBinding,
  type PersistedReportReceipt,
} from "@/features/report/persisted/view-contracts";
import {
  type ConsumerSaveBindingV2,
  type ConsumerCompleteBindingV2,
  type ConsumerStateV2,
} from "@/lib/consumer-contract/v2/state";
import type { PersistedReportReceiptV2 } from "@/features/report/persisted/view-contracts-v2";
import { observeConsumerSave, observeConsumerCompletion } from "./resolution";
import {
  observeConsumerSaveV2,
  observeConsumerCompletionV2,
} from "./resolution-v2";
import { verifyConsumerSessionView } from "./contracts";
import { verifyConsumerSessionViewV2 } from "./contracts-v2";
export {
  currentSaveInputSchema,
  currentSaveBindingSchema,
  currentCompleteBindingSchema,
  verifyCurrentSaveInput,
} from "./current-wire";
export async function observeCurrentSave(
  binding: ConsumerSaveBinding | ConsumerSaveBindingV2,
  state: ConsumerState | ConsumerStateV2,
  report: PersistedReportReceipt | PersistedReportReceiptV2 | null,
) {
  if (state.schemaVersion === "quizforge.consumer-state.v2") {
    if (
      binding.schemaVersion !== "quizforge.consumer-save.v2" ||
      (report &&
        report.schemaVersion !== "quizforge.consumer-report-receipt.v2")
    )
      throw new ConsumerError("INVALID_REQUEST");
    return observeConsumerSaveV2(binding, state, report);
  }
  if (
    binding.schemaVersion !== "quizforge.consumer-save.v1" ||
    (report && report.schemaVersion !== "quizforge.consumer-report-receipt.v1")
  )
    throw new ConsumerError("INVALID_REQUEST");
  return observeConsumerSave(binding, state, report);
}
export async function observeCurrentCompletion(
  binding: ConsumerCompleteBinding | ConsumerCompleteBindingV2,
  state: ConsumerState | ConsumerStateV2,
  report: PersistedReportReceipt | PersistedReportReceiptV2 | null,
) {
  if (state.schemaVersion === "quizforge.consumer-state.v2") {
    if (
      binding.schemaVersion !== "quizforge.consumer-complete.v2" ||
      (report &&
        report.schemaVersion !== "quizforge.consumer-report-receipt.v2")
    )
      throw new ConsumerError("INVALID_REQUEST");
    return observeConsumerCompletionV2(binding, state, report);
  }
  if (
    binding.schemaVersion !== "quizforge.consumer-complete.v1" ||
    (report && report.schemaVersion !== "quizforge.consumer-report-receipt.v1")
  )
    throw new ConsumerError("INVALID_REQUEST");
  return observeConsumerCompletion(binding, state, report);
}
export function verifyCurrentSessionView(
  input: unknown,
  sessionId: string,
  state: ConsumerState | ConsumerStateV2,
) {
  return state.schemaVersion === "quizforge.consumer-state.v2"
    ? verifyConsumerSessionViewV2(input, sessionId)
    : verifyConsumerSessionView(input, sessionId);
}
