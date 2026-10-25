import { describe, expect, it } from "vitest";
import { projectProductOperations, type EvidenceInput } from "./projection";
import {
  parseProductOperations,
  parseProductOperationsPage,
  parseOperationsDashboard,
} from "./response";
import { parseOperationsQuery, operationsListHref } from "./query";
import type { ProductDto } from "@/features/product/workspace/contracts";
import type { RevisionTarget } from "@/features/product/internal-versions/identity-contracts";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const asOf = "2026-10-24T00:00:00.000Z";
const target: RevisionTarget = {
  draftId: uuid(1),
  revision: 1,
  canonicalContentSha256: "a".repeat(64),
  assetSetSha256: "b".repeat(64),
  canonicalManifestSha256: "c".repeat(64),
};
const directory: ProductDto = {
  id: "synthetic",
  slug: "synthetic",
  title: "合成测评",
  metadataRevision: 1,
  createdAt: asOf,
  updatedAt: asOf,
  archivedAt: null,
  primaryCategory: null,
  tags: [],
};
const empty = (): EvidenceInput => ({
  reception: { total: 0, latest: null },
  validation: { total: 0, latest: null },
  draft: null,
  reviews: [],
  versions: [],
  testing: [],
});
const rich = (): EvidenceInput => ({
  ...empty(),
  draft: {
    target,
    sourceImportId: uuid(2),
    sourceValidationId: uuid(3),
    sourceValidationStateRevision: 4,
    candidateSha256: "d".repeat(64),
    createdAt: asOf,
  },
  reviews: [
    {
      id: uuid(4),
      target,
      reviewSha256: "e".repeat(64),
      sourceImportId: uuid(2),
      sourceValidationId: uuid(3),
      sourceValidationStateRevision: 4,
      baseline: {
        kind: "baseline",
        id: "synthetic",
        version: "1.0.0",
        entrySha256: "f".repeat(64),
      },
      approval: {
        kind: "synthetic-test",
        fixtureId: "synthetic",
        evidenceSha256: "f".repeat(64),
        scope: "test-evidence-no-author-approval",
      },
      recordedAt: asOf,
    },
  ],
  versions: [
    {
      id: uuid(5),
      target,
      reviewId: uuid(4),
      reviewSha256: "e".repeat(64),
      snapshotSha256: "f".repeat(64),
      createdAt: asOf,
    },
  ],
  testing: [
    {
      id: uuid(6),
      target,
      parentVersionId: uuid(5),
      parentSnapshotSha256: "f".repeat(64),
      snapshotSha256: "a".repeat(64),
      createdAt: asOf,
    },
  ],
});
const project = (input = empty()) =>
  projectProductOperations(directory, asOf, input);
describe("operations observations and response boundary", () => {
  it("distinguishes no draft, no review and unobservable browser operations", () => {
    const value = parseProductOperations(project(), directory.id);
    expect(value.content.draft).toEqual({
      state: "none",
      reason: "no-current-draft",
    });
    expect(value.review.current.state).toBe("not-applicable");
    expect(value.browserOperations.state).toBe("indeterminate");
    const input = rich();
    input.reviews = [];
    input.versions = [];
    input.testing = [];
    expect(parseProductOperations(project(input)).review.current.state).toBe(
      "none",
    );
  });
  it.each([
    "draftId",
    "revision",
    "canonicalContentSha256",
    "assetSetSha256",
    "canonicalManifestSha256",
  ] as const)(
    "keeps old review/version/testing historical when current %s changes",
    (key) => {
      const input = rich();
      input.draft!.target = {
        ...target,
        [key]:
          key === "revision"
            ? 2
            : key === "draftId"
              ? uuid(20)
              : "9".repeat(64),
      };
      const value = parseProductOperations(project(input));
      expect(value.review.current.state).toBe("none");
      expect(value.review.historicalCount).toBe(1);
      expect(value.versions.currentCount).toBe(0);
      expect(value.versions.historicalCount).toBe(1);
      expect(value.testing.currentCount).toBe(0);
      expect(value.testing.historicalCount).toBe(1);
    },
  );
  it("does not join independently newest import and validation by recency", () => {
    const input = empty();
    input.reception = {
      total: 2,
      latest: {
        id: uuid(10),
        status: "received",
        stateRevision: 2,
        storageCondition: "clean",
        createdAt: asOf,
      },
    };
    input.validation = {
      total: 1,
      latest: {
        id: uuid(11),
        importId: uuid(12),
        status: "ready",
        stateRevision: 4,
        storageCondition: "clean",
        candidateSha256: "a".repeat(64),
        createdAt: asOf,
      },
    };
    expect(
      parseProductOperations(project(input)).content.validation.latest.state,
    ).toBe("present");
  });
  it("rejects broken review source and play parent relationships", () => {
    const input = rich();
    input.reviews[0]!.sourceImportId = uuid(8);
    expect(() => project(input)).toThrow();
    const other = rich();
    other.testing[0]!.parentSnapshotSha256 = "0".repeat(64);
    expect(() => project(other)).toThrow();
  });
  it("rejects wrong scope, untrusted href, extra payload and oversized output", () => {
    const value = project(rich());
    expect(() => parseProductOperations(value, "other")).toThrow();
    expect(() => parseProductOperations({ ...value, answers: [] })).toThrow();
    expect(() =>
      parseProductOperations({
        ...value,
        nextActions: [
          { kind: "directory", href: "https://example.com", reason: "test" },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseProductOperations({
        ...value,
        directory: { ...directory, title: "a".repeat(65537) },
      }),
    ).toThrow();
  });
  it("checks page count, asOf, filter conditions and dashboard drill-down identity", () => {
    const item = project();
    const page = {
      schemaVersion: "quizforge.product-operations-page.v1",
      asOf,
      items: [item],
      page: 1,
      pageSize: 20,
      total: 1,
      hasNext: false,
    };
    expect(parseProductOperationsPage(page).total).toBe(1);
    expect(() => parseProductOperationsPage({ ...page, total: 0 })).toThrow();
    expect(() =>
      parseProductOperationsPage({ ...page, asOf: "2026-10-25T00:00:00.000Z" }),
    ).toThrow();
    expect(() =>
      parseProductOperationsPage(
        page,
        parseOperationsQuery(new URLSearchParams("review=missing")),
      ),
    ).toThrow();
    const metric = (params: string, count: number) => {
      const query = parseOperationsQuery(new URLSearchParams(params));
      return { count, query, href: operationsListHref(query) };
    };
    const dashboard = {
      schemaVersion: "quizforge.operations-dashboard.v1",
      asOf,
      directoryTotal: metric("status=all", 1),
      activeDrafts: metric("draft=present", 0),
      activeMissingReview: metric("review=missing", 0),
      recentCreated: [item],
    };
    expect(parseOperationsDashboard(dashboard).directoryTotal.count).toBe(1);
    expect(() =>
      parseOperationsDashboard({
        ...dashboard,
        activeMissingReview: {
          ...dashboard.activeMissingReview,
          href: "/studio/products",
        },
      }),
    ).toThrow();
  });
});
