import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { projectProductOperations } from "../operations/projection";
import {
  ProductWorkspaceContext,
  type ProductWorkspaceContextValue,
} from "./context";
import { ProductOverview } from "./overview";

const now = "2026-10-24T02:00:00.000Z";
const uuid = "00000000-0000-4000-8000-000000000001";
function fixture() {
  return projectProductOperations(
    {
      id: "overview-test",
      slug: "overview-test",
      title: "合成测评",
      metadataRevision: 1,
      primaryCategory: null,
      tags: [],
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
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
}
function render(
  value: ProductWorkspaceContextValue["read"]["value"],
  error?: string,
) {
  return renderToStaticMarkup(
    createElement(
      ProductWorkspaceContext.Provider,
      {
        value: {
          productId: "overview-test",
          read: { value, loading: false, error, refresh() {} },
        },
      },
      createElement(ProductOverview),
    ),
  );
}
describe("prototype-aligned overview", () => {
  it("keeps four task regions and one primary content direction in the empty state", () => {
    const html = render(fixture());
    for (const label of [
      "制作与下一步",
      "基本信息",
      "真实关联对象",
      "快捷入口",
    ])
      expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain("建议下一步：处理内容");
    expect(html).toContain("尚无草稿、审核或版本关联记录");
    expect(html).toContain("预览入口不代表已人工体验");
    expect(html).not.toMatch(/>已人工体验<|完成率|已发布/);
  });
  it("separates current r3 and historical r1 while keeping hashes in technical details", () => {
    const value = fixture();
    const target = {
      draftId: uuid,
      revision: 3,
      canonicalContentSha256: "a".repeat(64),
      assetSetSha256: "b".repeat(64),
      canonicalManifestSha256: "c".repeat(64),
    };
    value.content.draft = {
      state: "present",
      value: {
        target,
        sourceImportId: uuid,
        sourceValidationId: uuid,
        sourceValidationStateRevision: 1,
        candidateSha256: "d".repeat(64),
        createdAt: now,
      },
    };
    value.review.current = { state: "none", reason: "no-current-review" };
    value.versions.historicalCount = 1;
    value.versions.historical = {
      state: "present",
      value: {
        id: uuid,
        target: { ...target, revision: 1 },
        reviewId: uuid,
        reviewSha256: "e".repeat(64),
        snapshotSha256: "f".repeat(64),
        createdAt: now,
      },
    };
    const html = render(value);
    expect(html).toContain("建议下一步：核对当前修订");
    expect(html).toContain("当前草稿 r3");
    expect(html).toContain("固定内容版 r1");
    const normalText = html.split("<details")[0]!.replace(/<[^>]*>/g, "");
    expect(normalText).not.toContain(uuid);
    expect(normalText).not.toContain("a".repeat(64));
    expect(html).toContain("a".repeat(64));
  });
  it("shows a clear read error rather than a made-up next step", () => {
    const html = render(undefined, "读取失败");
    expect(html).toContain('role="alert"');
    expect(html).toContain("概览暂不可用");
    expect(html).not.toContain("建议下一步");
  });
});
