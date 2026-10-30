import type { DisplayEntryBodyV2 } from "@/lib/assessment-contract/display-v2";
import type { MatchingContextV1 } from "@/lib/assessment-contract/matching-v1";
import type { ConsumerAnswers, ConsumerProgress } from "../v1/state";
import type { ConsumerStateV2 } from "./state";
import type { PersistedReportViewV2 } from "@/features/report/persisted/view-contracts-v2";

export type ConsumerV2Draft = {
  answers: ConsumerAnswers;
  progress: ConsumerProgress;
  matchingContext: MatchingContextV1 | null;
};
export type ConsumerV2ReaderModel = {
  phase:
    | "loading"
    | "ready"
    | "saving"
    | "completing"
    | "unknown"
    | "conflict"
    | "completed"
    | "denied"
    | "unavailable";
  entry: DisplayEntryBodyV2 | null;
  state: ConsumerStateV2 | null;
  draft: ConsumerV2Draft | null;
  report: PersistedReportViewV2 | null;
  pendingOperation: "save" | "complete" | null;
  savedAt: string | null;
  message: string | null;
};
export type ConsumerV2ReaderEvent =
  | { type: "choose-preference"; preference: "male" | "female" | "any" }
  | { type: "choose-answer"; questionId: string; optionId: string }
  | { type: "navigate"; questionId: string | null }
  | { type: "save" }
  | { type: "complete" }
  | { type: "resolve" }
  | { type: "reload" }
  | { type: "logout" };
/** Pure renderer port. The controller owns pending, IO, CSRF and operation identity. */
export type ConsumerV2HostProps = {
  model: ConsumerV2ReaderModel;
  onEvent: (event: ConsumerV2ReaderEvent) => void;
};
