import { describe, it, expect } from "vitest";
import { matchesAppendSelection, joinRevisionHistory } from "./view-state";
import { base, tuple } from "./fixtures.test-support";
import type { DraftRevisionHistory } from "@/features/product/draft-revisions/contracts";
const source = {
  productId: tuple.productId,
  importId: tuple.sourceImportId,
  id: tuple.sourceValidationId,
  stateRevision: tuple.expectedValidationStateRevision,
  candidateSha256: tuple.expectedCandidateSha256,
};
describe("confirmation and fixed history state", () => {
  it("source/base changes invalidate an unsent confirmation without retargeting its original fields", () => {
    expect(matchesAppendSelection(tuple, source, base)).toBe(true);
    for (const value of [
      { ...base, revision: 2 },
      { ...base, assetSetSha256: "f".repeat(64) },
      { ...base, draftId: "77777777-7777-4777-8777-777777777777" },
    ])
      expect(matchesAppendSelection(tuple, source, value)).toBe(false);
    expect(
      matchesAppendSelection(
        tuple,
        { ...source, stateRevision: source.stateRevision + 1 },
        base,
      ),
    ).toBe(false);
    expect(tuple.target.expectedRevision).toBe(1);
  });
  it("continuations must retain scope, page size and exact anchored cursor", () => {
    const first: DraftRevisionHistory = {
      productId: base.productId,
      draftId: base.draftId,
      pageSize: 1,
      anchorRevision: 2,
      beforeRevision: 3,
      items: [{ ...base, revision: 2 }],
      nextBeforeRevision: 2,
    };
    const next: DraftRevisionHistory = {
      ...first,
      beforeRevision: 2,
      items: [base],
      nextBeforeRevision: null,
    };
    expect(joinRevisionHistory([first], next)).toHaveLength(2);
    expect(() => joinRevisionHistory([first], first)).toThrow();
    expect(() =>
      joinRevisionHistory([first], { ...next, anchorRevision: 3 }),
    ).toThrow();
    expect(() =>
      joinRevisionHistory([first], {
        ...next,
        draftId: "77777777-7777-4777-8777-777777777777",
      }),
    ).toThrow();
  });
});
