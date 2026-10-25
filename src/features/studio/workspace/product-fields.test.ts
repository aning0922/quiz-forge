import { describe, expect, it } from "vitest";
import type { ProductDto } from "@/features/product/workspace/contracts";
import { productFieldsDirty, type ProductFormFields } from "./product-fields";
const tag = (id: string) => ({
  id,
  name: id,
  slug: id,
  revision: 1,
  archivedAt: null,
});
const saved: ProductDto = {
  id: "synthetic-catalog",
  slug: "synthetic-catalog",
  title: "Synthetic catalog",
  metadataRevision: 1,
  createdAt: "2026-10-24T00:00:00.000Z",
  updatedAt: "2026-10-24T00:00:00.000Z",
  archivedAt: null,
  primaryCategory: tag("category"),
  tags: [tag("one"), tag("two")],
};
const fields = (): ProductFormFields => ({
  title: saved.title,
  slug: saved.slug,
  categories: [saved.primaryCategory!],
  tags: saved.tags,
});
describe("metadata dirty state for the shared leave guard", () => {
  it("protects actual unsaved text and association-ID changes", () => {
    expect(productFieldsDirty(fields(), saved)).toBe(false);
    expect(productFieldsDirty({ ...fields(), title: "Unsaved" }, saved)).toBe(
      true,
    );
    expect(productFieldsDirty({ ...fields(), slug: "different" }, saved)).toBe(
      true,
    );
    expect(productFieldsDirty({ ...fields(), categories: [] }, saved)).toBe(
      true,
    );
    expect(
      productFieldsDirty(
        { ...fields(), tags: [tag("three"), tag("two")] },
        saved,
      ),
    ).toBe(true);
  });
  it("does not treat reordered tags or refreshed names/revisions as unsaved metadata", () => {
    const value = fields();
    value.tags = [
      saved.tags[1]!,
      { ...saved.tags[0]!, name: "Renamed elsewhere", revision: 2 },
    ];
    value.categories = [
      { ...saved.primaryCategory!, name: "Renamed category" },
    ];
    expect(productFieldsDirty(value, saved)).toBe(false);
    expect(productFieldsDirty(value, { ...saved, metadataRevision: 2 })).toBe(
      false,
    );
  });
  it("clears dirty only when the actual fields match the newly adopted server value", () => {
    const next = { ...saved, title: "New current value", metadataRevision: 2 };
    expect(productFieldsDirty(fields(), next)).toBe(true);
    expect(productFieldsDirty({ ...fields(), title: next.title }, next)).toBe(
      false,
    );
  });
});
