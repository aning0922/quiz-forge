import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RevisionTarget } from "@/features/product/internal-versions/identity-contracts";
import type { Observation, ProductOperations } from "../operations/contracts";
import { ObservationValue, OperationsSummary } from "./summary";

const target = (revision: number): RevisionTarget => ({
  draftId: "00000000-0000-4000-8000-000000000003",
  revision,
  canonicalContentSha256: "a".repeat(64),
  assetSetSha256: "b".repeat(64),
  canonicalManifestSha256: "c".repeat(64),
});
const none = { state: "none", reason: "no-record" } as const;
function fixture(): ProductOperations {
  return {
    schemaVersion: "quizforge.product-operations.v1",
    asOf: "2026-10-24T02:00:00.000Z",
    directory: {
      id: "summary-test",
      title: "合成摘要",
      slug: "summary-test",
      primaryCategory: null,
      tags: [],
      metadataRevision: 1,
      archivedAt: null,
      createdAt: "2026-10-23T02:00:00.000Z",
      updatedAt: "2026-10-23T02:00:00.000Z",
    },
    content: {
      reception: {
        total: 2,
        latest: {
          state: "present",
          value: {
            id: "new-import",
            status: "receiving",
            stateRevision: 1,
            storageCondition: "unknown",
            createdAt: "2026-10-24T02:00:00.000Z",
          },
        },
      },
      validation: {
        total: 1,
        latest: {
          state: "present",
          value: {
            id: "old-validation",
            importId: "old-import",
            status: "ready",
            stateRevision: 4,
            storageCondition: "clean",
            candidateSha256: "d".repeat(64),
            createdAt: "2026-10-23T02:00:00.000Z",
          },
        },
      },
      draft: {
        state: "present",
        value: {
          target: target(3),
          sourceImportId: "old-import",
          sourceValidationId: "old-validation",
          sourceValidationStateRevision: 4,
          candidateSha256: "d".repeat(64),
          createdAt: "2026-10-23T03:00:00.000Z",
        },
      },
    },
    review: {
      current: none,
      historicalCount: 1,
      latestHistorical: {
        state: "present",
        value: {
          id: "review-r2",
          target: target(2),
          reviewSha256: "e".repeat(64),
          sourceImportId: "old-import",
          sourceValidationId: "old-validation",
          sourceValidationStateRevision: 4,
          baseline: {
            kind: "baseline",
            id: "baseline-test",
            version: "1.0.0",
            entrySha256: "f".repeat(64),
          },
          approval: {
            kind: "synthetic-test",
            fixtureId: "summary-test",
            evidenceSha256: "f".repeat(64),
            scope: "test-evidence-no-author-approval",
          },
          recordedAt: "2026-10-23T02:00:00.000Z",
        },
      },
    },
    versions: {
      currentCount: 0,
      current: none,
      historicalCount: 1,
      historical: {
        state: "present",
        value: {
          id: "version-r2",
          target: target(2),
          reviewId: "review-r2",
          reviewSha256: "e".repeat(64),
          snapshotSha256: "f".repeat(64),
          createdAt: "2026-10-23T02:00:00.000Z",
        },
      },
    },
    testing: {
      currentCount: 0,
      current: none,
      historicalCount: 1,
      historical: {
        state: "present",
        value: {
          id: "testing-r2",
          parentVersionId: "version-r2",
          parentSnapshotSha256: "f".repeat(64),
          snapshotSha256: "e".repeat(64),
          target: target(2),
          createdAt: "2026-10-23T02:00:00.000Z",
        },
      },
    },
    browserOperations: {
      state: "indeterminate",
      reason: "browser-operations-not-observable",
    },
    nextActions: [
      {
        kind: "review",
        href: "/studio/products/summary-test/internal-versions",
        reason: "current-review-missing",
      },
    ],
  };
}

describe("read-only operations presentation", () => {
  it("keeps r3 missing review distinct from r2 fixed and play evidence", () => {
    const html = renderToStaticMarkup(
      createElement(OperationsSummary, { value: fixture() }),
    );
    expect(html).toContain("缺少当前草稿的精确匹配审核");
    expect(html).toContain("历史审核 1 条");
    expect(html).toContain("父版本");
    expect(html).toContain("version-r2");
    expect(html).toContain("r3");
    expect(html).toContain("r2");
    for (const hash of ["a", "b", "c"]) expect(html).toContain(hash.repeat(64));
    expect(html).toContain("2026-10-24T02:00:00.000Z");
    expect(html).toContain(
      'href="/studio/products/summary-test/internal-versions"',
    );
    expect(html).toContain("浏览器未决操作");
    expect(html).not.toMatch(/进度百分比|已发布|人类预览已完成/);
  });
  it("labels unrelated reception and validation as independent representatives", () => {
    const html = renderToStaticMarkup(
      createElement(OperationsSummary, { value: fixture() }),
    );
    expect(html).toContain("接收：接收中");
    expect(html).toContain("检查：已就绪");
    expect(html).toContain("不表示来自同一次导入");
  });
  it.each([
    ["none", "无记录"],
    ["not-applicable", "不适用"],
    ["indeterminate", "无法判定"],
  ] as const)("preserves the %s evidence state", (state, label) => {
    const html = renderToStaticMarkup(
      ObservationValue<string>({
        observation: { state, reason: "test-reason" } as Observation<string>,
        absent: "无记录",
        children: (value) => value,
      }),
    );
    expect(html).toContain(label);
    if (state !== "none") expect(html).not.toContain("无记录");
  });
  it("does not call historical synthetic review author approval", () => {
    const value = fixture();
    value.review.current = value.review.latestHistorical;
    const html = renderToStaticMarkup(
      createElement(OperationsSummary, { value }),
    );
    expect(html).toContain("合成测试依据，非作者批准");
    expect(html).not.toContain("作者内测基线依据");
  });
});
