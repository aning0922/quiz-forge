import { describe, expect, it } from "vitest";
import { parseOperationsQuery, operationsListHref } from "./query";

describe("operations directory query", () => {
  it("keeps directory normalization, defaults and independent dimensions", () => {
    expect(
      parseOperationsQuery(
        new URLSearchParams("q=+e%CC%81+&draft=present&review=missing"),
      ),
    ).toEqual({
      page: 1,
      pageSize: 20,
      status: "active",
      unclassified: false,
      q: "é",
      draft: "present",
      review: "missing",
    });
    const value = parseOperationsQuery(
      new URLSearchParams(
        "status=all&draft=absent&review=current&page=1000&pageSize=50",
      ),
    );
    expect(
      parseOperationsQuery(
        new URL(operationsListHref(value), "http://localhost").searchParams,
      ),
    ).toEqual(value);
  });
  it.each([
    "draft=present&draft=absent",
    "review=any&review=current",
    "draft=ready",
    "review=approved",
    "page=01",
    "page=1001",
    "pageSize=51",
    "pageSize=0",
    "page=1&page=2",
    "sort=updated",
    "unclassified=true&categoryId=00000000-0000-0000-0000-000000000001",
    "q=a%00b",
    "__proto__=x",
  ])("rejects invalid or ambiguous query %s", (query) => {
    expect(() => parseOperationsQuery(new URLSearchParams(query))).toThrow();
  });
  it("rejects oversized queries before decoding", () => {
    expect(() =>
      parseOperationsQuery(new URLSearchParams({ q: "a".repeat(4097) })),
    ).toThrow();
  });
});
