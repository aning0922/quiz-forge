import { describe, expect, it } from "vitest";
import { projectProductOperations } from "../operations/projection";
import type {
  ProductOperations,
  ReviewEvidence,
  VersionEvidence,
} from "../operations/contracts";
import { productPresentation } from "./presentation";

const target = {
  draftId: "00000000-0000-4000-8000-000000000001",
  revision: 3,
  canonicalContentSha256: "a".repeat(64),
  assetSetSha256: "b".repeat(64),
  canonicalManifestSha256: "c".repeat(64),
};
const now = "2026-10-24T02:00:00.000Z";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const review: ReviewEvidence = {
  id: uuid(2),
  target,
  reviewSha256: "d".repeat(64),
  sourceImportId: uuid(3),
  sourceValidationId: uuid(4),
  sourceValidationStateRevision: 1,
  baseline: {
    kind: "baseline",
    id: "synthetic",
    version: "1.0.0",
    entrySha256: "e".repeat(64),
  },
  approval: {
    kind: "synthetic-test",
    fixtureId: "synthetic",
    evidenceSha256: "f".repeat(64),
    scope: "test-evidence-no-author-approval",
  },
  recordedAt: now,
};
const version: VersionEvidence = {
  id: uuid(5),
  target,
  reviewId: review.id,
  reviewSha256: review.reviewSha256,
  snapshotSha256: "f".repeat(64),
  createdAt: now,
};
function fixture(draft = true): ProductOperations {
  const value = projectProductOperations(
    {
      id: "presentation-test",
      title: "合成测评",
      slug: "presentation-test",
      primaryCategory: null,
      tags: [],
      metadataRevision: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    },
    now,
    {
      reception: { total: 0, latest: null },
      validation: { total: 0, latest: null },
      draft: null,
      reviews: [],
      versions: [],
      testing: [],
    },
  );
  if (draft) {
    value.content.draft = {
      state: "present",
      value: {
        target,
        sourceImportId: review.sourceImportId,
        sourceValidationId: review.sourceValidationId,
        sourceValidationStateRevision: 1,
        candidateSha256: "e".repeat(64),
        createdAt: now,
      },
    };
    value.review.current = { state: "none", reason: "no-review" };
  }
  return value;
}
describe("shared product presentation", () => {
  it("prioritizes indeterminate current versions/testing over zero counts and historical records", () => {
    const value = fixture();
    value.review.current = { state: "present", value: review };
    value.versions.current = {
      state: "indeterminate",
      reason: "unknown-version",
    };
    value.testing.current = {
      state: "indeterminate",
      reason: "unknown-testing",
    };
    value.testing.historicalCount = 1;
    const result = productPresentation(value);
    expect(result.primary.label).toBe("核实当前状态");
    expect(result.primary.reason).not.toContain("尚无匹配固定版");
    expect(result.testing).toEqual({
      label: "内测状态待核实",
      tone: "warning",
    });
    expect(result.historicalNote).toBe("历史内测 1 项");
  });
  it("selects one content action without a draft and no preview", () => {
    const result = productPresentation(fixture(false));
    expect(result.primary.href).toBe(
      "/studio/products/presentation-test/content",
    );
    expect(result.previewHref).toBeNull();
    expect(result.content.label).toBe("尚无内容");
  });
  it("prioritizes current r3 review over historical r1 testing", () => {
    const value = fixture();
    value.versions.historicalCount = 1;
    value.versions.historical = {
      state: "present",
      value: { ...version, target: { ...target, revision: 1 } },
    };
    value.testing.historicalCount = 1;
    value.testing.historical = {
      state: "present",
      value: {
        id: uuid(6),
        parentVersionId: version.id,
        parentSnapshotSha256: version.snapshotSha256,
        target: { ...target, revision: 1 },
        snapshotSha256: "a".repeat(64),
        createdAt: now,
      },
    };
    const result = productPresentation(value);
    expect(result.primary.label).toBe("核对当前修订");
    expect(result.primary.href).toContain("/revisions/3/internal-review");
    expect(result.previewHref).toContain("/revisions/3/preview");
    expect(result.review.tone).toBe("warning");
    expect(result.historicalNote).toBe("历史固定版 r1 · 历史内测 r1");
    expect(result.testing.label).toBe("仅有历史内测");
  });
  it("offers versions after exact review and testing after an exact current fixed version", () => {
    const value = fixture();
    value.review.current = { state: "present", value: review };
    expect(productPresentation(value).primary.href).toBe(
      "/studio/products/presentation-test/internal-versions",
    );
    value.versions.currentCount = 1;
    value.versions.current = { state: "present", value: version };
    expect(productPresentation(value).primary.href).toBe(
      "/studio/products/presentation-test/consumer-access",
    );
  });
  it("does not turn mismatched hashes or indeterminate facts into completion", () => {
    const value = fixture();
    value.review.current = {
      state: "present",
      value: {
        ...review,
        target: { ...target, assetSetSha256: "0".repeat(64) },
      },
    };
    expect(productPresentation(value).primary.label).toBe("核实当前状态");
    value.content.draft = { state: "indeterminate", reason: "unknown" };
    expect(productPresentation(value).previewHref).toBeNull();
    expect(productPresentation(value).review.tone).toBe("warning");
  });
  it("keeps archive actions read only and ignores arbitrary suggested hrefs", () => {
    const value = fixture();
    value.directory.archivedAt = now;
    value.nextActions = [
      { kind: "review", href: "https://example.com", reason: "untrusted" },
    ];
    expect(productPresentation(value).primary).toMatchObject({
      label: "查看测评",
      href: "/studio/products/presentation-test",
    });
  });
  it("does not connect unrelated latest reception and validation", () => {
    const value = fixture(false);
    value.content.reception.latest = {
      state: "present",
      value: {
        id: uuid(10),
        status: "receiving",
        stateRevision: 1,
        storageCondition: "clean",
        createdAt: now,
      },
    };
    value.content.validation.latest = {
      state: "present",
      value: {
        id: uuid(11),
        importId: uuid(12),
        status: "ready",
        stateRevision: 1,
        storageCondition: "clean",
        candidateSha256: "a".repeat(64),
        createdAt: now,
      },
    };
    expect(productPresentation(value).content).toEqual({
      label: "不同来源待核对",
      tone: "warning",
    });
  });
});
