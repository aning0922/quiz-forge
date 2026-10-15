import { describe, it, expect } from "vitest";
import {
  previewFixture,
  sourceBinding,
  answers,
  requestId,
} from "@/features/theme/preview/fixtures.test-support";
import {
  preparePreviewContent,
  scorePreview,
} from "@/features/theme/preview/projection";
import { PreviewFlow } from "./flow";
async function fixture() {
  const content = await previewFixture(),
    prepared = preparePreviewContent(content, sourceBinding(content));
  if (!prepared.ok) throw Error(prepared.code);
  const flow = new PreviewFlow(prepared.value.entry);
  for (const a of answers(content)) flow.edit(a.questionId, a.optionId);
  const ticket = flow.begin(requestId),
    scored = scorePreview(
      prepared.value.prepared,
      ticket.request.answers,
      requestId,
    );
  if (!scored.ok) throw Error(scored.code);
  return {
    content,
    prepared: prepared.value,
    flow,
    ticket,
    reveal: scored.value,
  };
}
describe("in-memory fixed revision answer generations", () => {
  it("accepts only the actual request and unchanged complete answer snapshot", async () => {
    const { flow, ticket, reveal } = await fixture();
    expect(flow.accepts(ticket, reveal)).toBe(true);
    expect(Object.isFrozen(ticket.request.answers)).toBe(true);
    expect(Object.isFrozen(ticket.request.answers[0])).toBe(true);
    expect(flow.accepts({ ...ticket }, reveal)).toBe(false);
    expect(
      flow.accepts(ticket, {
        ...reveal,
        requestId: "33333333-3333-4333-8333-333333333333",
      }),
    ).toBe(false);
    expect(
      flow.accepts(ticket, {
        ...reveal,
        binding: { ...reveal.binding, assetSetSha256: "0".repeat(64) },
      }),
    ).toBe(false);
  });
  it("editing, including returning to the same values, permanently rejects the old response", async () => {
    const { content, flow, ticket, reveal } = await fixture(),
      q = content.questions[0]!;
    flow.edit(q.id, q.options[1]!.id);
    flow.edit(q.id, q.options[0]!.id);
    expect(flow.accepts(ticket, reveal)).toBe(false);
    expect(flow.isCurrent(ticket.generation)).toBe(false);
  });
  it("a later score of identical answers supersedes the first ticket", async () => {
    const { flow, ticket, reveal } = await fixture();
    const newer = flow.begin("33333333-3333-4333-8333-333333333333");
    expect(flow.accepts(ticket, reveal)).toBe(false);
    expect(newer.snapshot).toBe(ticket.snapshot);
    expect(
      flow.accepts(newer, { ...reveal, requestId: newer.request.requestId }),
    ).toBe(true);
  });
  it("cancellation or unmount invalidation rejects a response even if transport ignored abort", async () => {
    const { flow, ticket, reveal } = await fixture();
    flow.invalidate();
    expect(flow.accepts(ticket, reveal)).toBe(false);
  });
  it("new page memory starts empty; malformed and incomplete choices never become a scoring request", async () => {
    const { prepared } = await fixture(),
      flow = new PreviewFlow(prepared.entry);
    expect(flow.currentAnswers).toEqual({});
    expect(() => flow.begin(requestId)).toThrow("PREVIEW_INVALID_ANSWERS");
    expect(() =>
      flow.edit(prepared.entry.questions[0]!.id, "another-question-option"),
    ).toThrow("PREVIEW_INVALID_ANSWERS");
    expect(flow.currentAnswers).toEqual({});
  });
});
