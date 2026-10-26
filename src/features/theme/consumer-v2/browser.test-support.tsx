import { createRoot } from "react-dom/client";
import type {
  ConsumerV2ReaderEvent,
  ConsumerV2ReaderModel,
} from "@/lib/consumer-contract/v2/client-contract";
import { ConsumerExperienceV2 } from "./host";
import { StudioStructurePreviewV2 } from "./studio-structure-preview";

/** Synthetic owner for isolated browser interaction checks; no HTTP, receipts or persistence. */
const fixture = JSON.parse(
  document.getElementById("fixture")!.textContent!,
) as { model: ConsumerV2ReaderModel; completed: ConsumerV2ReaderModel };
const root = createRoot(document.getElementById("root")!);
let current = structuredClone(fixture.model),
  studio = false;
const events: ConsumerV2ReaderEvent[] = [];
function onEvent(event: ConsumerV2ReaderEvent) {
  events.push(event);
  const next = structuredClone(current);
  if (event.type === "choose-preference" && next.draft && next.entry)
    next.draft.matchingContext = {
      schemaVersion: "quiz-matching-context.v1",
      preference: event.preference,
      policyRef: next.entry.matchingPolicyRef,
    };
  if (event.type === "choose-answer" && next.draft)
    next.draft.answers = [
      ...next.draft.answers.filter((a) => a.questionId !== event.questionId),
      { questionId: event.questionId, optionId: event.optionId },
    ];
  if (event.type === "navigate" && next.draft)
    next.draft.progress = { questionId: event.questionId };
  if (event.type === "save") {
    next.phase = "saving";
    next.pendingOperation = "save";
  }
  if (event.type === "complete") {
    next.phase = "completing";
    next.pendingOperation = "complete";
  }
  render(next);
}
function render(model: ConsumerV2ReaderModel) {
  current = model;
  const Component = studio ? StudioStructurePreviewV2 : ConsumerExperienceV2;
  root.render(<Component model={current} onEvent={onEvent} />);
}
Object.assign(window, {
  readerProbe: {
    events,
    fixture,
    getModel: () => structuredClone(current),
    render,
    setStudio(value: boolean) {
      studio = value;
      render(current);
    },
  },
});
render(current);
