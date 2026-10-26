import {
  temporaryPreviewEntryV2Schema,
  temporaryPreviewRequestV2Schema,
  samePreviewBindingV2,
  type TemporaryPreviewEntryV2,
  type TemporaryPreviewResultV2,
} from "@/features/product/preview/contracts-v2";
import type { MatchingContextV1 } from "@/lib/assessment-contract/matching-v1";

/** In-memory temporary inputs only. A generation ticket cancels stale results; no consumer state. */
export class TemporaryPreviewFlowV2 {
  readonly entry: TemporaryPreviewEntryV2;
  private generation = 0;
  private listeners = new Set<() => void>();
  private snapshot: Readonly<{
    answers: readonly { questionId: string; optionId: string }[];
    matchingContext: MatchingContextV1 | null;
  }> = { answers: [], matchingContext: null };
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish() {
    this.snapshot = Object.freeze({
      answers: this.answers,
      matchingContext: this.matchingContext,
    });
    for (const listener of this.listeners) listener();
  }

  private answers: { questionId: string; optionId: string }[] = [];
  private matchingContext: MatchingContextV1 | null = null;
  constructor(input: TemporaryPreviewEntryV2) {
    this.entry = temporaryPreviewEntryV2Schema.parse(structuredClone(input));
  }
  get currentAnswers() {
    return this.answers;
  }
  get currentMatchingContext() {
    return this.matchingContext;
  }
  invalidate() {
    return ++this.generation;
  }
  edit(questionId: string, optionId: string) {
    if (
      !this.entry.entry.questions.some(
        (q) =>
          q.ref.id === questionId &&
          q.options.some((o) => o.ref.id === optionId),
      )
    )
      throw Error("PREVIEW_INVALID_ANSWERS");
    this.invalidate();
    this.answers = [
      ...this.answers.filter((a) => a.questionId !== questionId),
      { questionId, optionId },
    ];
    this.publish();
  }
  preference(value: MatchingContextV1["preference"]) {
    if (!this.entry.entry.preferences.includes(value))
      throw Error("PREVIEW_INVALID_ANSWERS");
    this.invalidate();
    this.matchingContext = {
      schemaVersion: "quiz-matching-context.v1",
      preference: value,
      policyRef: this.entry.entry.matchingPolicyRef,
    };
    this.publish();
  }
  begin(requestId: string) {
    if (
      !this.matchingContext ||
      this.answers.length !== this.entry.entry.questions.length
    )
      throw Error("PREVIEW_INVALID_ANSWERS");
    const request = temporaryPreviewRequestV2Schema.parse({
      binding: this.entry.binding,
      requestId,
      answers: this.answers,
      matchingContext: this.matchingContext,
    });
    return { generation: this.invalidate(), request };
  }
  accepts(
    ticket: ReturnType<TemporaryPreviewFlowV2["begin"]>,
    result: TemporaryPreviewResultV2,
  ) {
    return (
      ticket.generation === this.generation &&
      result.requestId === ticket.request.requestId &&
      samePreviewBindingV2(result.binding, ticket.request.binding)
    );
  }
}
