/** Existing directory query only; no operational status or Key aggregation. */
export const DASHBOARD_PRODUCTS_PATH =
  "/api/studio/products?status=all&page=1&pageSize=5";

export function testingProductsPath(q: string, page: number) {
  return `/api/studio/products?${new URLSearchParams({
    status: "all",
    page: String(page),
    pageSize: "20",
    q,
  })}`;
}
