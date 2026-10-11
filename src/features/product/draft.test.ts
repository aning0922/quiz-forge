import { describe, expect, it } from "vitest";
import {
  createDraftEvidenceBinding,
  createProductDraft,
  matchesDraftEvidence,
  updateProductDraft,
} from "./draft";

const create = () =>
  createProductDraft({
    productId: "synthetic-a",
    draftId: "draft-a",
    content: { nested: { title: "Synthetic" }, answers: [1, 2] },
  });
const request = {
  productId: "synthetic-a",
  draftId: "draft-a",
  expectedRevision: 1,
};

describe("F1 local product drafts", () => {
  it("detaches caller inputs, old draft and replacement content", () => {
    const content = { nested: { title: "Synthetic" }, answers: [1, 2] };
    const draft = createProductDraft({
      productId: request.productId,
      draftId: request.draftId,
      content,
    });
    content.nested.title = "caller changed";
    expect(draft.content).toEqual({
      nested: { title: "Synthetic" },
      answers: [1, 2],
    });
    const replacement = { nested: { title: "Revised" } };
    const updated = updateProductDraft(draft, {
      ...request,
      content: replacement,
    });
    replacement.nested.title = "caller changed again";
    expect(updated.content).toEqual({ nested: { title: "Revised" } });
    (updated.content as typeof replacement).nested.title = "output changed";
    expect(draft.content).toEqual({
      nested: { title: "Synthetic" },
      answers: [1, 2],
    });
    expect(updated.revision).toBe(2);
    expect(updated.contentHash).not.toBe(draft.contentHash);
  });

  it("requires fixed identities and expected revision", () => {
    const draft = create();
    expect(() =>
      updateProductDraft(draft, { ...request, expectedRevision: 2 }),
    ).toThrow();
    expect(() =>
      updateProductDraft(draft, { ...request, productId: "synthetic-b" }),
    ).toThrow();
    expect(() =>
      updateProductDraft(draft, { ...request, draftId: "draft-b" }),
    ).toThrow();
    expect(draft.revision).toBe(1);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid revision %s",
    (revision) => {
      expect(() =>
        updateProductDraft(
          { ...create(), revision },
          { ...request, expectedRevision: revision },
        ),
      ).toThrow();
      expect(() =>
        updateProductDraft(create(), {
          ...request,
          expectedRevision: revision,
        }),
      ).toThrow();
    },
  );

  it("rejects revision overflow, tampered hash and tampered nested content", () => {
    expect(() =>
      updateProductDraft(
        { ...create(), revision: Number.MAX_SAFE_INTEGER },
        { ...request, expectedRevision: Number.MAX_SAFE_INTEGER, content: {} },
      ),
    ).toThrow();
    expect(() =>
      updateProductDraft({ ...create(), contentHash: "0".repeat(64) }, request),
    ).toThrow();
    expect(() =>
      updateProductDraft({ ...create(), content: { modified: true } }, request),
    ).toThrow();
  });

  it("keeps a no-op detached and revision-stable; equivalent content preserves revision", () => {
    const draft = create();
    const evidence = createDraftEvidenceBinding(draft);
    const noop = updateProductDraft(draft, request);
    expect(noop).toEqual(draft);
    expect(noop).not.toBe(draft);
    expect(noop.content).not.toBe(draft.content);
    expect(matchesDraftEvidence(noop, evidence)).toBe(true);
    const replacement = updateProductDraft(draft, {
      ...request,
      content: draft.content,
    });
    expect(replacement.revision).toBe(1);
    expect(replacement.contentHash).toBe(draft.contentHash);
    expect(matchesDraftEvidence(replacement, evidence)).toBe(true);
  });

  it("binds evidence to all four fields and expires it on changed content", () => {
    const draft = create();
    const evidence = createDraftEvidenceBinding(draft);
    expect(matchesDraftEvidence(draft, evidence)).toBe(true);
    for (const altered of [
      { productId: "synthetic-b" },
      { draftId: "draft-b" },
      { revision: 2 },
      { contentHash: "0".repeat(64) },
      { approved: true },
    ]) {
      expect(matchesDraftEvidence(draft, { ...evidence, ...altered })).toBe(
        false,
      );
    }
    expect(
      matchesDraftEvidence(
        updateProductDraft(draft, { ...request, content: null }),
        evidence,
      ),
    ).toBe(false);
    expect(
      matchesDraftEvidence({ ...draft, contentHash: "0".repeat(64) }, evidence),
    ).toBe(false);
  });

  it("does not grant domain validity to ordinary JSON and rejects invalid envelopes", () => {
    expect(
      createProductDraft({
        productId: "synthetic",
        draftId: "draft",
        content: null,
      }).content,
    ).toBeNull();
    expect(() =>
      createProductDraft({ productId: " ", draftId: "draft", content: {} }),
    ).toThrow();
    expect(() =>
      updateProductDraft(create(), {
        ...request,
        contentHash: "0".repeat(64),
      } as typeof request),
    ).toThrow();
    expect(() =>
      createProductDraft({
        productId: "synthetic",
        draftId: "draft",
        content: undefined,
      }),
    ).toThrow();
  });
});
