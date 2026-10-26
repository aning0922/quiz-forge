import { describe, expect, it } from "vitest";
import { productWorkspaceTabs, activeProductWorkspaceTab } from "./navigation";
describe("one four-task product navigation", () => {
  it("uses the four current task URLs without a six-tab parallel landing", () => {
    expect(
      productWorkspaceTabs("example").map(({ label, href }) => [label, href]),
    ).toEqual([
      ["内容制作", "/studio/products/example?task=content"],
      ["体验预览", "/studio/products/example?task=preview"],
      ["审核封存", "/studio/products/example?task=review"],
      ["内测发放", "/studio/products/example?task=testing"],
    ]);
  });
  it.each([
    ["imports/source", "content"],
    ["imports/source/validations/check", "content"],
    ["drafts/draft/revisions/2", "content"],
    ["drafts/draft/revisions/2/preview", "preview"],
    ["drafts/draft/revisions/2/internal-review", "review"],
    ["internal-versions/version", "review"],
  ])("classifies formal object detail %s", (path, task) => {
    expect(
      activeProductWorkspaceTab("/studio/products/example/" + path, "example"),
    ).toBe(task);
  });
  it("does not map removed pages or another product to a task", () => {
    for (const path of [
      "content",
      "preview",
      "draft",
      "imports",
      "internal-versions",
      "consumer-access",
      "settings",
      "unknown",
    ])
      expect(
        activeProductWorkspaceTab(
          "/studio/products/example/" + path,
          "example",
        ),
      ).toBeNull();
    expect(
      activeProductWorkspaceTab("/studio/products/other/imports/id", "example"),
    ).toBeNull();
  });
});
