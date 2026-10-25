import { describe, expect, it } from "vitest";
import type { Page, TaxonomyDto } from "@/features/product/workspace/contracts";
import { taxonomyOptionsAreEmpty } from "./taxonomy-picker";

const empty: Page<TaxonomyDto> = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 10,
  hasNext: false,
};
describe("taxonomy option empty presentation", () => {
  it("compacts only a confirmed unfiltered first-page empty result", () => {
    expect(taxonomyOptionsAreEmpty(empty, "", 1)).toBe(true);
  });
  it("keeps search available when only a search has no matches", () => {
    expect(taxonomyOptionsAreEmpty(empty, "nonmatching category", 1)).toBe(
      false,
    );
  });
  it("keeps navigation available on an empty later page", () => {
    expect(taxonomyOptionsAreEmpty({ ...empty, page: 2 }, "", 2)).toBe(false);
  });
  it("does not infer an empty directory from an empty page with a positive total", () => {
    expect(taxonomyOptionsAreEmpty({ ...empty, total: 12 }, "", 1)).toBe(false);
  });
  it("does not replace loading or read failure with an empty-directory claim", () => {
    expect(taxonomyOptionsAreEmpty(undefined, "", 1)).toBe(false);
  });
});
