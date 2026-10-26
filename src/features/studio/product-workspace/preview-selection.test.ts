import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { projectProductOperations } from "../operations/projection";
import { previewPagePath } from "@/features/product/preview/urls";
import {
  selectPreviewTarget,
  previewSelectionStatus,
} from "./preview-selection";
import { ContentWorkbench } from "./content-workbench";
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
describe("fixed preview selection", () => {
  it("captures a full independent target only on explicit selection", () => {
    const input = { ...target };
    const selection = selectPreviewTarget("hubs-test", input);
    input.assetSetSha256 = "0".repeat(64);
    expect(selection.target).toEqual(target);
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
describe("content workbench facts", () => {
  it("does not combine unrelated reception and validation into the current source", () => {
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
    const html = renderToStaticMarkup(
      createElement(ContentWorkbench, {
        value,
        loading: false,
        onOpenTask() {},
        onOpenHistory() {},
        onPreview() {},
      }),
    );
    expect(html).toContain("当前来源接收需按记录核对");
    expect(html).toContain("当前来源检查需按记录核对");
    expect(html).toContain("当前内容 r2");
  });
  it("keeps failed reading distinct from an empty draft", () => {
    const html = renderToStaticMarkup(
      createElement(ContentWorkbench, {
        value: undefined,
        loading: false,
        error: "读取失败",
        onOpenTask() {},
        onOpenHistory() {},
        onPreview() {},
      }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("当前内容待核实");
    expect(html).not.toContain("还没有内容草稿");
  });
});
