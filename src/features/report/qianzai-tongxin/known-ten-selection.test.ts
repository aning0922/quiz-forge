import { expect, it } from "vitest";
import { QIANZAI_KNOWN_TEN_ROLES } from "./known-ten-catalog";
import {
  qianzaiKnownCatalogOptions,
  qianzaiKnownCatalogRole,
} from "./known-ten-selection";

it("uses only the author-confirmed versioned ten-person catalogue", () => {
  expect(QIANZAI_KNOWN_TEN_ROLES.map((r) => r.id)).toEqual([
    "li-bai",
    "su-shi",
    "tang-yin",
    "zhou-yu",
    "zhao-yun",
    "li-qingzhao",
    "yang-yuhuan",
    "wu-zetian",
    "wang-zhaojun",
    "cai-wenji",
  ]);
  for (const entry of QIANZAI_KNOWN_TEN_ROLES) {
    expect(qianzaiKnownCatalogRole(entry.ref)).toBe(entry);
    expect(
      qianzaiKnownCatalogRole({ ...entry.ref, version: "2.0.0" }),
    ).toBeUndefined();
    expect(
      qianzaiKnownCatalogRole({ ...entry.ref, productId: "other" }),
    ).toBeUndefined();
  }
  for (const id of [
    "wang-wei",
    "xin-qiji",
    "wang-xizhi",
    "sun-wukong",
    "唐伯虎",
  ])
    expect(
      qianzaiKnownCatalogRole({
        productId: "qianzai-tongxin",
        id,
        version: "3.0.0",
      }),
    ).toBeUndefined();
});

it("selects UI options by preference without changing catalogue order or granting authority", () => {
  expect(qianzaiKnownCatalogOptions("male").map((r) => r.sex)).toEqual(
    Array(5).fill("male"),
  );
  expect(qianzaiKnownCatalogOptions("female").map((r) => r.sex)).toEqual(
    Array(5).fill("female"),
  );
  expect(qianzaiKnownCatalogOptions("any")).toEqual(QIANZAI_KNOWN_TEN_ROLES);
  for (const entry of qianzaiKnownCatalogOptions("any")) {
    expect(entry).not.toHaveProperty("canonicalContentSha256");
    expect(entry).not.toHaveProperty("renderer");
  }
});
