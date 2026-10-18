import {
  samePreviewBinding,
  type PreviewEntry,
  type PreviewReveal,
  type PreviewScoreRequest,
} from "@/features/product/preview/contracts";

import type { DisplayAnswers } from "@/lib/assessment-contract/display-v1";
export type Answers = DisplayAnswers;
export type ScoreTicket = Readonly<{
  generation: number;
  request: PreviewScoreRequest;
  snapshot: string;
}>;
/** One in-memory page. Abort is an optimization; monotonic generations are the acceptance gate. */
export class PreviewFlow {
  private generation = 0;
  private answers: Answers = Object.freeze({});
  private active: ScoreTicket | undefined;
  readonly entry: PreviewEntry;
  constructor(entry: PreviewEntry) {
    const freeze = (value: object) => {
      for (const child of Object.values(value)) {
        if (child && typeof child === "object") freeze(child);
      }
      Object.freeze(value);
    };
    this.entry = structuredClone(entry);
    freeze(this.entry);
  }
  get currentAnswers() {
    return this.answers;
  }
  get version() {
    return this.generation;
  }
  edit(questionId: string, optionId: string) {
    const question = this.entry.questions.find((q) => q.id === questionId);
    if (!question?.options.some((o) => o.id === optionId))
      throw Error("PREVIEW_INVALID_ANSWERS");
    this.generation++;
    this.active = undefined;
    this.answers = Object.freeze({ ...this.answers, [questionId]: optionId });
  }
  invalidate() {
    this.generation++;
    this.active = undefined;
  }
  begin(requestId: string): ScoreTicket {
    this.invalidate();
    const answers = this.entry.questions.map((q) => {
      const optionId = this.answers[q.id];
      if (!optionId) throw Error("PREVIEW_INVALID_ANSWERS");
      return Object.freeze({ questionId: q.id, optionId });
    });
    const request = Object.freeze({
      binding: this.entry.binding,
      requestId,
      answers: Object.freeze(
        answers,
      ) as unknown as PreviewScoreRequest["answers"],
    });
    this.active = Object.freeze({
      generation: this.generation,
      request,
      snapshot: JSON.stringify(answers),
    });
    return this.active;
  }
  accepts(ticket: ScoreTicket, reveal: PreviewReveal) {
    return (
      this.active === ticket &&
      this.generation === ticket.generation &&
      reveal.requestId === ticket.request.requestId &&
      samePreviewBinding(reveal.binding, this.entry.binding) &&
      ticket.snapshot ===
        JSON.stringify(
          this.entry.questions.map((q) => ({
            questionId: q.id,
            optionId: this.answers[q.id],
          })),
        )
    );
  }
  isCurrent(generation: number) {
    return generation === this.generation;
  }
}
