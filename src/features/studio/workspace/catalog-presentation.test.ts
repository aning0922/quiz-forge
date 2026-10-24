import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductOperations } from "../operations/contracts";
import { operationsQuerySchema } from "../operations/query";
import { ProductCard } from "./product-card";
import { CatalogProducts } from "./catalog-products";
import { CatalogFilters } from "./catalog-filters";
import { StudioDashboard } from "../dashboard";

const readers = vi.hoisted(() => ({ dashboard: vi.fn(), products: vi.fn() }));
vi.mock("../operations-ui/read", () => ({
  useOperationsDashboard: readers.dashboard,
  useOperationsProducts: readers.products,
}));
const none = { state: "none", reason: "no-record" } as const;
const directory = {
  id: "compact-test",
  title: "合成测评",
  slug: "compact-test",
  primaryCategory: null,
  tags: [],
  metadataRevision: 7,
  archivedAt: null,
  createdAt: "2026-10-23T02:00:00.000Z",
  updatedAt: "2026-10-24T02:00:00.000Z",
};
function operation(id = "compact-test"): ProductOperations {
  return {
    schemaVersion: "quizforge.product-operations.v1",
    asOf: "2026-10-24T03:00:00.000Z",
    directory: {
      ...directory,
      id,
      title: id === "compact-test" ? directory.title : id,
    },
    content: {
      reception: { total: 0, latest: none },
      validation: { total: 0, latest: none },
      draft: none,
    },
    review: { current: none, historicalCount: 0, latestHistorical: none },
    versions: {
      currentCount: 0,
      historicalCount: 0,
      current: none,
      historical: none,
    },
    testing: {
      currentCount: 0,
      historicalCount: 0,
      current: none,
      historical: none,
    },
    browserOperations: {
      state: "indeterminate",
      reason: "browser-operations-not-observable",
    },
    nextActions: [],
  };
}
function currentDraft(value: ProductOperations) {
  value.content.draft = {
    state: "present",
    value: {
      target: {
        draftId: "00000000-0000-4000-8000-000000000003",
        revision: 3,
        canonicalContentSha256: "a".repeat(64),
        assetSetSha256: "b".repeat(64),
        canonicalManifestSha256: "c".repeat(64),
      },
      sourceImportId: "00000000-0000-4000-8000-000000000001",
      sourceValidationId: "00000000-0000-4000-8000-000000000002",
      sourceValidationStateRevision: 4,
      candidateSha256: "d".repeat(64),
      createdAt: value.asOf,
    },
  };
  return value;
}
const metric = (count: number) => ({
  count,
  href: "/studio/products",
  query: operationsQuerySchema.parse({}),
});

beforeEach(() => {
  readers.dashboard.mockReturnValue({
    loading: false,
    error: undefined,
    refresh: vi.fn(),
    value: {
      asOf: "2026-10-24T03:00:00.000Z",
      directoryTotal: metric(20),
      activeDrafts: metric(8),
      activeMissingReview: metric(6),
      recentCreated: [operation("recent-only")],
    },
  });
  readers.products.mockReturnValue({
    loading: false,
    error: undefined,
    refresh: vi.fn(),
    value: {
      asOf: "2026-10-24T03:01:00.000Z",
      total: 6,
      items: [currentDraft(operation("queue-only"))],
      hasNext: true,
      page: 1,
      pageSize: 5,
    },
  });
});

describe("compact catalog surfaces", () => {
  it("shows current content and independent testing without full evidence or action menus", () => {
    const html = renderToStaticMarkup(
      createElement(CatalogProducts, { products: [currentDraft(operation())] }),
    );
    expect(html).toContain("当前草稿 r3");
    expect(html).toContain("r3 待核对审核");
    expect(html).toContain("尚无当前内测");
    expect(html).toContain("目录更新时间");
    expect(html).toContain(`dateTime="${directory.updatedAt}"`);
    expect(html).not.toContain("a".repeat(64));
    expect(html).not.toContain("摘要依据与完整目标");
    expect(html).not.toContain("编号与标签详情");
    const card = renderToStaticMarkup(
      createElement(ProductCard, {
        product: directory,
        operations: operation(),
      }),
    );
    expect((card.match(/href=/g) ?? []).length).toBe(2); // Title opens overview; one explicit primary action.
    expect(card).toContain('href="/studio/products/compact-test"');
    expect(card).toContain("进入工作区");
  });
  it("preserves identity, metadata revision and separate-tab reconciliation when operations is absent", () => {
    const html = renderToStaticMarkup(
      createElement(ProductCard, {
        product: directory,
        showIdentity: true,
        newTab: true,
      }),
    );
    expect(html).toContain("信息版本：7");
    expect(html).toContain("测评编号：compact-test");
    expect(html).toContain("编号与标签详情");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("在新标签查看服务器记录");
    expect(html).not.toContain("处理内容");
  });
  it("restores independent draft/review and archive filters without inventing a stage", () => {
    const query = operationsQuerySchema.parse({
      draft: "present",
      review: "missing",
      status: "archived",
    });
    const html = renderToStaticMarkup(
      createElement(CatalogFilters, {
        query,
        busy: false,
        onApply: vi.fn(),
        onReset: vi.fn(),
      }),
    );
    for (const value of ["present", "missing", "archived"])
      expect(html).toContain(`value="${value}" selected=""`);
    expect(html).toContain("全部分类");
    expect(html).not.toContain("全部阶段");
  });
});

describe("dashboard independently observed review queue", () => {
  it("queries the bounded exact fact set and keeps the two observation times distinct", () => {
    const html = renderToStaticMarkup(
      createElement(StudioDashboard, { canCreate: true }),
    );
    expect(readers.products).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "active",
        draft: "present",
        review: "missing",
        page: 1,
        pageSize: 5,
      }),
    );
    expect(html).toContain("queue-only");
    expect(html).toContain("recent-only");
    expect(html).toContain("2026-10-24T03:00:00.000Z");
    expect(html).toContain("2026-10-24T03:01:00.000Z");
    expect(html).toContain("独立读取于");
    expect(html).toContain("集合共 6 项");
    expect(html).not.toContain("摘要依据与完整目标");
  });
  it("keeps review-query failure separate from a successful recent list", () => {
    readers.products.mockReturnValue({
      loading: false,
      error: "合成读取错误",
      refresh: vi.fn(),
      value: undefined,
    });
    const html = renderToStaticMarkup(
      createElement(StudioDashboard, { canCreate: false }),
    );
    expect(html).toContain("不能据此判断是否存在审核缺口");
    expect(html).toContain("recent-only");
    expect(html).not.toContain("此次读取没有符合该条件的测评");
  });
});
