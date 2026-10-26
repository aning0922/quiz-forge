import { beforeAll, expect, it } from "vitest";
import { TemporaryPreviewFlowV2 } from "./flow-v2";
import { temporaryPreviewFixtureV2 } from "@/features/product/preview/v2.test-support";
let f: Awaited<ReturnType<typeof temporaryPreviewFixtureV2>>;
beforeAll(async () => {
  f = await temporaryPreviewFixtureV2();
});
it("requires explicit preference and all answers; edited/cancelled/foreign results cannot replace current input", () => {
  const flow = new TemporaryPreviewFlowV2(f.entry);
  for (const a of f.request.answers) flow.edit(a.questionId, a.optionId);
  expect(() => flow.begin(f.request.requestId)).toThrow(
    "PREVIEW_INVALID_ANSWERS",
  );
  flow.preference("any");
  const ticket = flow.begin(f.request.requestId);
  expect(flow.accepts(ticket, f.result)).toBe(true);
  flow.preference("female");
  expect(flow.accepts(ticket, f.result)).toBe(false);
  expect(flow.currentAnswers).toHaveLength(24);
  const newer = flow.begin(f.request.requestId);
  expect(
    flow.accepts(newer, {
      ...f.result,
      binding: { ...f.binding, revision: 2 },
    }),
  ).toBe(false);
  flow.invalidate();
  expect(flow.accepts(newer, f.result)).toBe(false);
});
