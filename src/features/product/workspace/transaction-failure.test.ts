import { describe, it, expect } from "vitest";
import { isStudioConnectionFailure } from "@/lib/auth/write";
describe("stable driver invalidation classification", () => {
  it("recognizes the non-enumerable marker regardless of originating SQLSTATE", () => {
    const fault = Object.defineProperty(
      new Error("Synthetic"),
      "quizforgeConnectionInvalidated",
      { value: true },
    );
    expect(Object.keys(fault)).toEqual([]);
    expect(isStudioConnectionFailure(fault)).toBe(true);
  });
  it.each(["53200", "57P05", "XX000"])(
    "treats %s FATAL/PANIC as unknown without enumerating states",
    (code) => {
      for (const severity of ["FATAL", "PANIC"])
        expect(isStudioConnectionFailure({ code, severity })).toBe(true);
      expect(isStudioConnectionFailure({ code, severity: "ERROR" })).toBe(
        false,
      );
    },
  );
  it.each(["ECONNRESET", "EPIPE", "ETIMEDOUT", "CONNECTION_CLOSED", "08006"])(
    "defensively recognizes %s",
    (code) => {
      expect(isStudioConnectionFailure({ code })).toBe(true);
    },
  );
  it("keeps normal business and SQL rollback errors distinct", () => {
    for (const value of [
      null,
      undefined,
      "failure",
      { code: "57014", severity: "ERROR" },
      { code: "23505", severity: "ERROR" },
      { code: "22012", severity: "ERROR" },
    ])
      expect(isStudioConnectionFailure(value)).toBe(false);
  });
});
