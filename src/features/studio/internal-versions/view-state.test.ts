import { describe, expect, it } from "vitest";
import {
  internalVersionListSchema,
  type InternalReviewState,
} from "@/features/product/internal-versions/contracts";
import {
  fixture,
  binding,
  uuid,
  renderer,
  engine,
  sha,
} from "./fixtures.test-support";
import {
  reviewRequestFromState,
  sealRequestFromState,
  internalConfirmation,
  matchesInternalConfirmation,
  matchesInternalSelection,
  reviewApprovalPresentation,
  versionRevisionRelation,
  INTERNAL_VERSION_DISCLOSURE,
} from "./view-state";
async function state(reviewed = false): Promise<InternalReviewState> {
  const f = await fixture();
  return {
    productId: binding.productId,
    target: binding.target,
    observedCurrentRevision: 2,
    review: reviewed ? f.review : null,
    baseline: binding.baseline,
    rendererChoices: [{ renderer, capability: "studio-internal-preview" }],
    engine,
  };
}
const empty = () =>
  internalVersionListSchema.parse({
    productId: binding.productId,
    versions: [],
  });
describe("head-only selection and honest baseline/version display state", () => {
  it("new identical reads or failed detail reads invalidate confirmation without changing its tuple", async () => {
    const s = await state(),
      request = reviewRequestFromState(s, uuid(90)),
      confirm = internalConfirmation(request, s);
    expect(matchesInternalConfirmation(confirm, s)).toBe(true);
    expect(matchesInternalConfirmation(confirm, structuredClone(s))).toBe(
      false,
    );
    expect(matchesInternalConfirmation(confirm, undefined)).toBe(false);
    expect(confirm.request.tuple.idempotencyKey).toBe(uuid(90));
    expect(
      matchesInternalSelection(request, { ...s, observedCurrentRevision: 3 }),
    ).toBe(false);
    expect(
      matchesInternalSelection(request, {
        ...s,
        baseline: { ...binding.baseline, entrySha256: sha("e") },
      }),
    ).toBe(false);
  });
  it("cannot invent a baseline, approve an already reviewed target, or prepare from a historical head", async () => {
    const s = await state();
    expect(() =>
      reviewRequestFromState({ ...s, baseline: null }, uuid(90)),
    ).toThrow();
    expect(() =>
      reviewRequestFromState({ ...s, observedCurrentRevision: 3 }, uuid(90)),
    ).toThrow();
    const reviewed = await state(true);
    expect(() => reviewRequestFromState(reviewed, uuid(90))).toThrow();
  });
  it("seal selects only registered server choices and requires reliable capacity with unchanged read objects", async () => {
    const s = await state(true),
      list = empty();
    const request = sealRequestFromState(s, renderer, uuid(90), list),
      confirm = internalConfirmation(request, s, list);
    expect(matchesInternalConfirmation(confirm, s, list)).toBe(true);
    expect(matchesInternalConfirmation(confirm, s, structuredClone(list))).toBe(
      false,
    );
    expect(matchesInternalSelection(request, s, undefined)).toBe(false);
    expect(
      matchesInternalSelection(
        request,
        { ...s, engine: { ...engine, entrySha256: sha("a") } },
        list,
      ),
    ).toBe(false);
    expect(() =>
      sealRequestFromState(
        s,
        { ...renderer, entrySha256: sha("a") },
        uuid(91),
        list,
      ),
    ).toThrow();
    expect(() =>
      sealRequestFromState({ ...s, review: null }, renderer, uuid(91), list),
    ).toThrow();
  });
  it("a fully occupied immutable slot list cannot re-enable new preparation after a capacity proof is cleared", async () => {
    const s = await state(true),
      f = await fixture();
    const versions = Array.from({ length: 100 }, (_, i) => ({
      id: uuid(100 + i),
      slot: 100 - i,
      productId: binding.productId,
      target: binding.target,
      reviewId: f.review.id,
      reviewSha256: f.review.reviewSha256,
      snapshotSha256: (100 + i).toString(16).padStart(64, "0"),
      renderer,
      rendererCapability: "studio-internal-preview",
      engine,
      purpose: "internal-test",
      publicationApproved: false,
      createdAt: f.version.createdAt,
      createdBy: f.version.createdBy,
    }));
    const full = internalVersionListSchema.parse({
      productId: binding.productId,
      versions,
    });
    expect(() => sealRequestFromState(s, renderer, uuid(90), full)).toThrow();
    expect(() =>
      sealRequestFromState(s, renderer, uuid(90), {
        ...empty(),
        productId: "another-product",
      }),
    ).toThrow();
  });
  it("keeps author approval provenance separate from operator recording and synthetic evidence", async () => {
    const f = await fixture();
    const synthetic = reviewApprovalPresentation(f.review);
    expect(synthetic.label).toContain("非作者批准");
    expect(synthetic.approvedOn).toBeNull();
    expect(synthetic.recordedBy).toBe(f.review.recordedBy);
    const author = {
      ...f.review,
      facts: {
        ...f.review.facts,
        approval: {
          kind: "author-baseline" as const,
          approvedOn: "2026-10-18",
          sourceRecordId: "synthetic-author-source",
          evidenceSha256: sha(),
          scope: "internal-test-content-and-visual-baseline" as const,
        },
      },
    };
    const display = reviewApprovalPresentation(author);
    expect(display.label).toBe("作者既有内测基线批准");
    expect(display.source).not.toBe(display.recordedBy);
    expect(display.approvedOn).toBe("2026-10-18");
    expect(INTERNAL_VERSION_DISCLOSURE).toContain("不授予对外发布资格");
    expect(versionRevisionRelation(2, 3)).toContain("历史修订");
    expect(versionRevisionRelation(3, 3)).toContain("本次读取");
    expect(versionRevisionRelation(3, undefined)).toContain("尚未可靠读取");
  });
});
