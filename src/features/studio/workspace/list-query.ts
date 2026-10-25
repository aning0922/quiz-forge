import type { OperationsQuery } from "../operations/contracts";
import { parseOperationsQuery, operationsListHref } from "../operations/query";

export type CatalogSearchParams = Record<string, string | string[] | undefined>;
export type CatalogQueryResult =
  { ok: true; query: OperationsQuery } | { ok: false; message: string };

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
    return { ok: true, query: parseOperationsQuery(params) };
  } catch {
    return {
      ok: false,
      message:
        "此列表地址包含无效或重复的筛选参数。尚未查询目录，请重置筛选或返回上一页。",
    };
  }
}

export function catalogQueryString(query: OperationsQuery): string {
  return operationsListHref(query).split("?")[1]!;
}

export const catalogPageHref = operationsListHref;
