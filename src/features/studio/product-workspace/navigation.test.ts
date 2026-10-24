import { describe, expect, it } from "vitest";
import { activeProductWorkspaceTab, productWorkspaceTabs } from "./navigation";

const productId = "workspace-test";
const base = `/studio/products/${productId}`;
describe("product business navigation", () => {
  it("keeps six distinct destinations inside the selected product", () => {
    const tabs = productWorkspaceTabs(productId);
    expect(tabs.map((tab) => tab.label)).toEqual([
      "概览",
      "内容与素材",
      "体验预览",
      "审核与版本",
      "内部测试",
      "基本设置",
    ]);
    expect(tabs.map((tab) => tab.href)).toEqual([
      base,
      `${base}/content`,
      `${base}/preview`,
      `${base}/internal-versions`,
      `${base}/consumer-access`,
      `${base}/settings`,
    ]);
    for (const tab of tabs)
      expect(activeProductWorkspaceTab(tab.href, productId)).toBe(tab.id);
  });
  it.each([
    ["/imports", "content"],
    ["/imports/old-import", "content"],
    ["/imports/old-import/validations/old-validation", "content"],
    ["/draft", "content"],
    ["/drafts/draft-id/revisions/2", "content"],
    ["/drafts/draft-id/revisions/2/preview", "preview"],
    ["/drafts/draft-id/revisions/2/internal-review", "versions"],
    ["/internal-versions/version-id", "versions"],
  ] as const)("classifies the unchanged deep link %s", (suffix, expected) => {
    expect(activeProductWorkspaceTab(base + suffix, productId)).toBe(expected);
  });
  it("never highlights another product or an unknown route as overview", () => {
    for (const path of [
      `${base}-other/draft`,
      "/studio/products/other/preview",
      `${base}/unknown`,
      `${base}/drafts/id/revisions/2/not-preview`,
    ])
      expect(activeProductWorkspaceTab(path, productId)).toBeNull();
  });
  it("supports a trailing slash without changing a fixed revision destination", () => {
    expect(
      activeProductWorkspaceTab(
        `${base}/drafts/id/revisions/2/preview/`,
        productId,
      ),
    ).toBe("preview");
  });
});
