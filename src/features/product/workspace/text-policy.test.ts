import { describe, it, expect } from "vitest";
import { DIRECTORY_TEXT_FORBIDDEN } from "./text-policy";
import {
  taxonomyNameSchema,
  titleSchema,
  productListQuerySchema,
  taxonomyListQuerySchema,
} from "./contracts";
describe("frozen exhaustive Unicode directory text policy", () => {
  it("matches the source property policy over every Unicode code point", () => {
    let mismatches = 0;
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      const c = String.fromCodePoint(cp);
      if (
        DIRECTORY_TEXT_FORBIDDEN.test(c) !==
        /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]/u.test(c)
      )
        mismatches++;
    }
    expect(mismatches).toBe(0);
  });
  it.each(["\u3000", "\u00a0", "X\u0600", "X\ufff9", "X\u{e0001}"])(
    "rejects blank/format text %j",
    (name) => {
      expect(taxonomyNameSchema.safeParse(name).success).toBe(false);
      expect(titleSchema.safeParse(name).success).toBe(false);
    },
  );
  it("retains normal CJK and emoji and trims Unicode spaces", () => {
    expect(taxonomyNameSchema.parse("\u3000中文 😀\u00a0")).toBe("中文 😀");
  });
});

describe("UTF-16 validity before display normalization", () => {
  it.each([
    "X\uD800",
    "X\uDC00",
    "\uD800X",
    "\uD800 \uDC00",
    "X\uDBFF",
    "X\uDFFF",
  ])("rejects lone surrogate input %j", (value) => {
    expect(titleSchema.safeParse(value).success).toBe(false);
    expect(taxonomyNameSchema.safeParse(value).success).toBe(false);
    expect(productListQuerySchema.safeParse({ q: value }).success).toBe(false);
    expect(taxonomyListQuerySchema.safeParse({ q: value }).success).toBe(false);
  });
  it("preserves valid surrogate pairs and accepts literal replacement characters", () => {
    for (const value of ["X\uD83D\uDE00", "X\uD840\uDC00", "X\uFFFD"]) {
      expect(titleSchema.parse(value)).toBe(value);
      expect(taxonomyNameSchema.parse(value)).toBe(value);
      expect(productListQuerySchema.parse({ q: value }).q).toBe(value);
      expect(taxonomyListQuerySchema.parse({ q: value }).q).toBe(value);
    }
  });
});
