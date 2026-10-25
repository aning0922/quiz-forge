import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { projectProductOperations } from "../operations/projection";
import { previewPagePath } from "@/features/product/preview/urls";
import {
  ProductWorkspaceContext,
  type ProductWorkspaceContextValue,
} from "./context";
import { ProductContentHub } from "./content-hub";
import {
  ProductPreviewHub,
  selectPreviewTarget,
  previewSelectionStatus,
} from "./preview-hub";
const now = "2026-10-24T02:00:00.000Z";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const target = {
  draftId: uuid(1),
  revision: 2,
  canonicalContentSha256: "a".repeat(64),
  assetSetSha256: "b".repeat(64),
  canonicalManifestSha256: "c".repeat(64),
};
function fixture() {
  const value = projectProductOperations(
    {
      id: "hubs-test",
      slug: "hubs-test",
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
  value.content.draft = {
    state: "present",
    value: {
      target: { ...target },
      sourceImportId: uuid(2),
      sourceValidationId: uuid(3),
      sourceValidationStateRevision: 4,
      candidateSha256: "d".repeat(64),
      createdAt: now,
    },
  };
  return value;
}
function render(
  component: typeof ProductContentHub | typeof ProductPreviewHub,
  value: ProductWorkspaceContextValue["read"]["value"],
  error?: string,
) {
  return renderToStaticMarkup(
    createElement(
      ProductWorkspaceContext.Provider,
      {
        value: {
          productId: "hubs-test",
          read: { value, loading: false, error, refresh() {} },
        },
      },
      createElement(component),
    ),
  );
}
describe("fixed preview selection", () => {
  it("captures a full independent target only on explicit selection", () => {
    const input = { ...target };
    const selection = selectPreviewTarget("hubs-test", input);
    input.assetSetSha256 = "0".repeat(64);
    expect(selection.target).toEqual(target);
    const html = render(ProductPreviewHub, fixture());
    expect(html).toContain("当前草稿 r2");
    expect(html).toContain("尚未选择修订");
    expect(html).not.toContain("打开 r2 体验预览");
    expect(html).not.toContain("checked=");
  });
  it.each([
    "draftId",
    "revision",
    "canonicalContentSha256",
    "assetSetSha256",
    "canonicalManifestSha256",
  ] as const)(
    "keeps the old target and stops calling it current when %s changes",
    (key) => {
      const selection = selectPreviewTarget("hubs-test", target);
      const originalUrl = previewPagePath({
        productId: selection.productId,
        ...selection.target,
      });
      const value = fixture();
      if (value.content.draft.state !== "present")
        throw Error("DRAFT_REQUIRED");
      expect(previewSelectionStatus(selection, "hubs-test", value).label).toBe(
        "当前草稿修订",
      );
      value.content.draft.value.target = {
        ...target,
        [key]:
          key === "revision" ? 3 : key === "draftId" ? uuid(8) : "9".repeat(64),
      };
      expect(
        previewSelectionStatus(selection, "hubs-test", value).label,
      ).not.toBe("当前草稿修订");
      expect(selection.target).toEqual(target);
      expect(
        previewPagePath({
          productId: selection.productId,
          ...selection.target,
        }),
      ).toBe(originalUrl);
    },
  );
  it("keeps selection during loading/error and labels an exact historical target", () => {
    const selection = selectPreviewTarget("hubs-test", target);
    expect(
      previewSelectionStatus(selection, "hubs-test", undefined),
    ).toMatchObject({
      tone: "warning",
      label: "所选修订保留 · 当前归属待核实",
    });
    const value = fixture();
    if (value.content.draft.state !== "present") throw Error("DRAFT_REQUIRED");
    value.content.draft.value.target.revision = 3;
    value.versions.historical = {
      state: "present",
      value: {
        id: uuid(5),
        target: { ...target },
        reviewId: uuid(6),
        reviewSha256: "e".repeat(64),
        snapshotSha256: "f".repeat(64),
        createdAt: now,
      },
    };
    expect(previewSelectionStatus(selection, "hubs-test", value).label).toBe(
      "历史固定版本的来源修订",
    );
    expect(previewSelectionStatus(selection, "different", value).tone).toBe(
      "warning",
    );
  });
});
describe("content and preview task presentation", () => {
  it("separates latest intake, independent validation and the draft's own source", () => {
    const value = fixture();
    value.content.reception.latest = {
      state: "present",
      value: {
        id: uuid(10),
        status: "received",
        stateRevision: 2,
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
        stateRevision: 4,
        storageCondition: "clean",
        candidateSha256: "a".repeat(64),
        createdAt: now,
      },
    };
    const html = render(ProductContentHub, value);
    expect(html).toContain("不是同一来源");
    expect(html).toContain("此草稿有自己的来源检查");
    expect(html).toContain(`/imports/${uuid(12)}/validations/${uuid(11)}`);
    expect(html).toContain(`/imports/${uuid(2)}/validations/${uuid(3)}`);
    expect(html).toContain("明确形成草稿修订");
    expect(html).toContain("当前 r2");
  });
  it("does not call empty/failed preview state a ready experience", () => {
    const empty = fixture();
    empty.content.draft = { state: "none", reason: "none" };
    const html = render(ProductPreviewHub, empty);
    expect(html).toContain("尚无可选择的草稿");
    expect(html).toContain("尚未选择修订");
    expect(html).not.toMatch(/<iframe|<img/);
    const failed = render(ProductPreviewHub, undefined, "读取失败");
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("当前归属无法判定");
    expect(failed).not.toContain("尚无可选择的草稿");
  });
});
