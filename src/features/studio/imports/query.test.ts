import { describe, expect, it } from "vitest";
import { exactIntentQuery, parseImportQuery } from "./query";

describe("import query boundary", () => {
  it.each([
    "unknown=1",
    "page=1&page=2",
    "page=01",
    "page=0",
    "page=1001",
    "pageSize=51",
    "status=all",
    "idempotencyKey=UPPER",
    "__proto__=bad",
  ])("rejects %s", (query) => {
    expect(() => parseImportQuery(new URLSearchParams(query))).toThrow();
  });
  it("exact recovery uses one row on page one, without a status filter", () => {
    const key = "00000000-0000-0000-0000-000000000001";
    expect(
      parseImportQuery(new URLSearchParams(exactIntentQuery(key))),
    ).toEqual({ page: 1, pageSize: 1, idempotencyKey: key });
    expect(parseImportQuery(new URLSearchParams())).toEqual({
      page: 1,
      pageSize: 20,
    });
  });
});
