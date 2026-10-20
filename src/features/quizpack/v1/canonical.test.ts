import { describe, expect, it } from "vitest";
import { canonicalFoundationJson } from "../../../lib/foundation-json";
import { canonicalP1Json, P1CanonicalError } from "./canonical";
import { canonicalPackJson } from "./io";

describe("independent P1 canonical budgets", () => {
  it("permits normalized content above 1MiB without relaxing F1", () => {
    const value = { content: "a".repeat(1024 * 1024) };
    expect(() => canonicalFoundationJson(value)).toThrow("JSON input rejected");
    expect(canonicalPackJson(value)).toBe(canonicalP1Json(value));
    expect(() => canonicalP1Json(value, "manifest")).toThrow(P1CanonicalError);
  });
  it("accounts exact UTF-8 bytes and syntax at both fixed limits", () => {
    for (const [budget, maximum] of [
      ["manifest", 512 * 1024],
      ["content", 2 * 1024 * 1024],
    ] as const) {
      expect(
        Buffer.byteLength(canonicalP1Json("a".repeat(maximum - 2), budget)),
      ).toBe(maximum);
      expect(() => canonicalP1Json("a".repeat(maximum - 1), budget)).toThrow(
        P1CanonicalError,
      );
      expect(() =>
        canonicalP1Json("中".repeat(Math.ceil(maximum / 3)), budget),
      ).toThrow(P1CanonicalError);
    }
  });
  it("preserves sorted-key/numeric semantics of F1 inside its budget", () => {
    const value = { z: [1e3, -0, true, null], a: "中\n" };
    expect(canonicalP1Json(value)).toBe(canonicalFoundationJson(value));
  });
  it("rejects JavaScript unknown and inherited budget names before lookup", () => {
    const call = canonicalP1Json as (input: unknown, budget: string) => string;
    for (const budget of [
      "constructor",
      "__proto__",
      "toString",
      "depth",
      "unknown",
    ])
      expect(() => call(null, budget)).toThrow(P1CanonicalError);
  });
  it("does not execute hostile objects and rejects holes, cycles and special keys", () => {
    let reads = 0;
    const getter = {
      get value() {
        reads++;
        return "private";
      },
    };
    const cycle: { self?: object } = {};
    cycle.self = cycle;
    for (const value of [
      getter,
      new Proxy({}, {}),
      [, ,],
      cycle,
      new Date(),
      JSON.parse('{"__proto__":1}'),
    ]) {
      expect(() => canonicalP1Json(value)).toThrow(P1CanonicalError);
    }
    expect(reads).toBe(0);
  });
});
