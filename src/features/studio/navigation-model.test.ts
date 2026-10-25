import { describe, expect, it } from "vitest";
import { studioLocation } from "./navigation-model";

describe("Studio navigation location", () => {
  it("keeps existing product deep links in measurement management", () => {
    for (const pathname of [
      "/studio/new-product",
      "/studio/products",
      "/studio/products/example",
      "/studio/products/example/consumer-access",
      "/studio/products/example/authoring",
    ]) {
      expect(studioLocation(pathname).section).toBe("products");
    }
  });

  it("groups existing taxonomy and session pages under settings", () => {
    expect(studioLocation("/studio/taxonomy")).toEqual({
      section: "settings",
      title: "分类与标签",
    });
    expect(studioLocation("/studio/session")).toEqual({
      section: "settings",
      title: "身份与退出",
    });
    expect(studioLocation("/studio")).toEqual({
      section: "dashboard",
      title: "工作台",
    });
    expect(studioLocation("/studio/testing").section).toBe("testing");
  });

  it("does not mark unrelated or authentication paths as a product page", () => {
    for (const pathname of [
      "/studio/products-extra",
      "/studio/login",
      "/studio-other",
    ])
      expect(studioLocation(pathname).section).toBeNull();
  });
});
