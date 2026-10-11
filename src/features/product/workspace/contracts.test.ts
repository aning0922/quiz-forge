import { describe, it, expect } from "vitest";
import {
  productCreateSchema,
  taxonomyCreateSchema,
  productReplaceMetadataSchema,
  parseWorkspaceQuery,
} from "./contracts";
const input = {
  id: "synthetic-product",
  slug: "synthetic-product",
  title: "标题",
  primaryCategoryId: null,
  tagIds: [],
};
describe("B1 strict browser contracts", () => {
  it("normalizes NFC and trim, counts code points", () => {
    expect(
      productCreateSchema.parse({ ...input, title: " e\u0301 " }).title,
    ).toBe("é");
    expect(
      productCreateSchema.safeParse({ ...input, title: "😀".repeat(120) })
        .success,
    ).toBe(true);
    expect(
      productCreateSchema.safeParse({ ...input, title: "😀".repeat(121) })
        .success,
    ).toBe(false);
  });
  it.each(["\ninside", "a\nb", "a<b", "a\u0000b", "a\u200bb", " "])(
    "rejects invalid display text %j",
    (title) => {
      // Leading/trailing whitespace is normalized; internal controls must be rejected.
      expect(
        productCreateSchema.safeParse({
          ...input,
          title: title === "\ninside" ? "a\ninside" : title,
        }).success,
      ).toBe(false);
    },
  );
  it("does not rewrite identity or accept unknown fields or coerced revisions", () => {
    expect(
      productCreateSchema.safeParse({ ...input, id: "Synthetic" }).success,
    ).toBe(false);
    expect(
      productCreateSchema.safeParse({ ...input, actor: "x" }).success,
    ).toBe(false);
    expect(
      productReplaceMetadataSchema.safeParse({
        ...input,
        id: undefined,
        expectedMetadataRevision: "1",
      }).success,
    ).toBe(false);
    expect(
      taxonomyCreateSchema.safeParse({
        slug: "synthetic",
        name: "😀".repeat(41),
      }).success,
    ).toBe(false);
  });
  it("rejects duplicate/extra tags", () => {
    const id = "00000000-0000-0000-0000-000000000001";
    expect(
      productCreateSchema.safeParse({ ...input, tagIds: [id, id] }).success,
    ).toBe(false);
    expect(
      productCreateSchema.safeParse({ ...input, tagIds: Array(9).fill(id) })
        .success,
    ).toBe(false);
  });
  it("decodes bounded queries and exact taxonomy slug", () => {
    expect(
      parseWorkspaceQuery(
        new URLSearchParams("slug=synthetic&status=all"),
        "taxonomy",
      ).slug,
    ).toBe("synthetic");
    expect(
      parseWorkspaceQuery(new URLSearchParams("q=+&page=2"), "product").q,
    ).toBe("");
    for (const query of [
      "page=01",
      "page=1&page=2",
      "pageSize=51",
      "unclassified=1",
      "unknown=x",
      "unclassified=true&categoryId=00000000-0000-0000-0000-000000000001",
    ])
      expect(() =>
        parseWorkspaceQuery(new URLSearchParams(query), "product"),
      ).toThrow();
  });
});
