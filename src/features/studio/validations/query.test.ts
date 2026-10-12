import { describe, expect, it } from "vitest";
import { exactValidationQuery, parseValidationQuery } from "./query";
import { tuple } from "./fixtures.test-support";
describe("strict validation query", () => {
  it("parses bounded canonical pagination and exact key without status", () => {
    expect(parseValidationQuery(new URLSearchParams())).toEqual({
      page: 1,
      pageSize: 20,
    });
    expect(
      parseValidationQuery(
        new URLSearchParams(exactValidationQuery(tuple.expectedValidationKey)),
      ),
    ).toEqual({
      page: 1,
      pageSize: 1,
      validationKey: tuple.expectedValidationKey,
    });
  });
  it.each([
    "page=0",
    "page=01",
    "page=1&page=2",
    "page=1001",
    "pageSize=51",
    "status=passed",
    "validationKey=UPPER",
    "policy=unsafe",
  ])("rejects %s", (query) => {
    expect(() => parseValidationQuery(new URLSearchParams(query))).toThrow();
  });
});
