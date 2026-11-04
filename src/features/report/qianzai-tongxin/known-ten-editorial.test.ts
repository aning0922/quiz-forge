import { expect, it } from "vitest";
import { QIANZAI_KNOWN_TEN_ROLES } from "./known-ten-catalog";
import { qianzaiKnownEditorial } from "./known-ten-editorial";

it("joins every new catalogue reference to its exact historical editorial and four asset selectors", () => {
  for (const role of QIANZAI_KNOWN_TEN_ROLES) {
    const data = qianzaiKnownEditorial(role.ref);
    expect(data?.profile.ref).toEqual(role.ref);
    expect(data?.profile.displayName).toBe(role.displayName);
    expect(data?.resourceRefs).toEqual(role.resourceRefs);
    expect(data?.profile.quotes.length).toBeGreaterThan(0);
    expect(data).not.toHaveProperty("canonicalContentSha256");
    expect(data).not.toHaveProperty("renderer");
  }
});

it("does not alias an old source's role reference or an unlisted identity into new prose", () => {
  const ref = { productId: "qianzai-tongxin", id: "su-shi", version: "3.0.0" };
  for (const version of ["1.0.0", "2.0.0"])
    expect(qianzaiKnownEditorial({ ...ref, version })).toBeUndefined();
  expect(qianzaiKnownEditorial({ ...ref, productId: "other" })).toBeUndefined();
  for (const id of ["wang-wei", "sun-wukong", "wang-xizhi", "苏轼"])
    expect(qianzaiKnownEditorial({ ...ref, id })).toBeUndefined();
});
