import {
  parseWorkspaceQuery,
  productListQuerySchema,
  type ProductListQuery,
} from "@/features/product/workspace/contracts";

export type CatalogSearchParams = Record<string, string | string[] | undefined>;
export type CatalogQueryResult =
  { ok: true; query: ProductListQuery } | { ok: false; message: string };

/** Use exactly the existing API grammar, including duplicate/conflicting filters. */
export function readCatalogQuery(
  search: CatalogSearchParams | URLSearchParams,
): CatalogQueryResult {
  const params = new URLSearchParams();
  for (const [name, value] of search instanceof URLSearchParams
    ? search
    : Object.entries(search)) {
    for (const item of Array.isArray(value)
      ? value
      : value === undefined
        ? []
        : [value])
      params.append(name, item);
  }
  try {
    return { ok: true, query: parseWorkspaceQuery(params, "product") };
  } catch {
    return {
      ok: false,
      message:
        "此列表地址包含无效或重复的筛选参数。尚未查询目录，请重置筛选或返回上一页。",
    };
  }
}

export function catalogQueryString(input: ProductListQuery): string {
  const query = productListQuerySchema.parse(input);
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
    status: query.status,
  });
  if (query.q) params.set("q", query.q);
  if (query.categoryId) params.set("categoryId", query.categoryId);
  if (query.tagId) params.set("tagId", query.tagId);
  if (query.unclassified) params.set("unclassified", "true");
  return params.toString();
}

export function catalogPageHref(query: ProductListQuery): string {
  return `/studio/products?${catalogQueryString(query)}`;
}
