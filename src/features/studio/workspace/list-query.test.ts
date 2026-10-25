import { describe, expect, it } from "vitest";
import {
  readCatalogQuery,
  catalogQueryString,
  catalogPageHref,
} from "./list-query";
const categoryId = "00000000-0000-4000-8000-000000000001";
const tagId = "00000000-0000-4000-8000-000000000002";

describe("catalog URL uses the existing server query contract", () => {
  it("starts with actual active-page defaults and no inferred business stage", () => {
    expect(readCatalogQuery({})).toEqual({
      ok: true,
      query: {
        page: 1,
        pageSize: 20,
        status: "active",
        unclassified: false,
        draft: "any",
        review: "any",
      },
    });
  });
  it("restores all filters and pagination across an address round trip without inventing taxonomy names", () => {
    const result = readCatalogQuery({
      page: "3",
      pageSize: "10",
      status: "all",
      q: " e\u0301 & story ",
      categoryId,
      tagId,
      draft: "present",
      review: "missing",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error("QUERY_REQUIRED");
    expect(result.query.q).toBe("é & story");
    const url = new URL(
      catalogPageHref(result.query),
      "https://example.invalid",
    );
    expect(url.pathname).toBe("/studio/products");
    expect(readCatalogQuery(url.searchParams)).toEqual(result);
    expect(result.query.categoryId).toBe(categoryId);
    expect(result.query.tagId).toBe(tagId);
    expect(result.query.draft).toBe("present");
    expect(result.query.review).toBe("missing");
  });
  it("preserves a syntactically valid filter ID even when its name is not loaded", () => {
    const result = readCatalogQuery({ categoryId });
    expect(result.ok && result.query.categoryId).toBe(categoryId);
  });
  it.each([
    { page: "0" },
    { page: "01" },
    { page: "1001" },
    { pageSize: "51" },
    { status: "published" },
    { draft: "ready" },
    { review: "approved" },
    { draft: ["any", "absent"] },
    { review: ["missing", "current"] },
    { unclassified: "True" },
    { categoryId: "not-an-id" },
    { categoryId, unclassified: "true" },
    { sort: "updatedAt" },
    { status: ["active", "archived"] },
    { q: "x".repeat(81) },
    { q: "x\ny" },
  ])(
    "rejects invalid query %j instead of fabricating an empty list",
    (search) => {
      const result = readCatalogQuery(search);
      expect(result.ok).toBe(false);
      expect("query" in result).toBe(false);
    },
  );
  it("also rejects duplicate parameters in live browser search strings", () => {
    expect(readCatalogQuery(new URLSearchParams("page=1&page=2")).ok).toBe(
      false,
    );
  });
  it("keeps unclassified, search and page size when moving to another server page", () => {
    const result = readCatalogQuery({
      unclassified: "true",
      q: "name",
      pageSize: "1",
      draft: "absent",
      review: "current",
    });
    if (!result.ok) throw Error("QUERY_REQUIRED");
    const next = new URLSearchParams(
      catalogQueryString({ ...result.query, page: 2 }),
    );
    expect(next.get("unclassified")).toBe("true");
    expect(next.get("q")).toBe("name");
    expect(next.get("pageSize")).toBe("1");
    expect(next.get("page")).toBe("2");
    expect(next.get("draft")).toBe("absent");
    expect(next.get("review")).toBe("current");
  });
});
