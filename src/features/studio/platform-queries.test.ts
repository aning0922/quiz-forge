import { describe, expect, it } from "vitest";
import {
  DASHBOARD_PRODUCTS_PATH,
  testingProductsPath,
} from "./platform-queries";
import { parseWorkspaceQuery } from "@/features/product/workspace/contracts";

describe("platform directory requests", () => {
  it("uses a bounded existing directory query for the dashboard", () => {
    const url = new URL(DASHBOARD_PRODUCTS_PATH, "http://localhost");
    expect(url.pathname).toBe("/api/studio/products");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: "all",
      page: "1",
      pageSize: "5",
    });
    expect(parseWorkspaceQuery(url.searchParams, "product")).toMatchObject({
      status: "all",
      page: 1,
      pageSize: 5,
    });
  });

  it("preserves search text as one parameter while paginating all directory states", () => {
    const q = "测评 & name/编号?=1";
    const url = new URL(testingProductsPath(q, 2), "http://localhost");
    expect(url.pathname).toBe("/api/studio/products");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: "all",
      page: "2",
      pageSize: "20",
      q,
    });
    expect(parseWorkspaceQuery(url.searchParams, "product")).toMatchObject({
      status: "all",
      page: 2,
      pageSize: 20,
      q,
    });
  });
});
