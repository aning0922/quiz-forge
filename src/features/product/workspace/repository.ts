import "server-only";
import type postgres from "postgres";
import { dateFromDatabase, type DatabaseTime } from "@/lib/auth/internal";
import { StudioError } from "@/lib/http-security/errors";
import type {
  ProductDto,
  TaxonomyDto,
  TaxonomyKind,
  TaxonomySummary,
  ProductListQuery,
  TaxonomyListQuery,
  Page,
} from "./contracts";
export type Tx = postgres.TransactionSql;
export type ProductRow = {
  id: string;
  slug: string;
  title: string;
  primary_category_id: string | null;
  metadata_revision: number;
  created_at: DatabaseTime;
  updated_at: DatabaseTime;
  archived_at: DatabaseTime | null;
};
export type TaxonomyRow = {
  id: string;
  slug: string;
  name: string;
  revision: number;
  created_at: DatabaseTime;
  updated_at: DatabaseTime;
  archived_at: DatabaseTime | null;
};
export const iso = (time: DatabaseTime) => dateFromDatabase(time).toISOString();
export const nullableIso = (time: DatabaseTime | null) =>
  time === null ? null : iso(time);
export const tableName = (kind: TaxonomyKind) => {
  if (kind !== "category" && kind !== "tag")
    throw new StudioError("INVALID_REQUEST");
  return kind === "category" ? "qf.category" : "qf.tag";
};
export const summary = (row: TaxonomyRow): TaxonomySummary => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  revision: row.revision,
  archivedAt: nullableIso(row.archived_at),
});
export async function productRow(
  tx: Tx,
  id: string,
  lock = false,
): Promise<ProductRow> {
  const [row] = await tx<
    ProductRow[]
  >`SELECT id,slug,title,primary_category_id,metadata_revision,created_at,updated_at,archived_at FROM qf.product WHERE id=${id} ${lock ? tx`FOR UPDATE` : tx``}`;
  if (!row) throw new StudioError("PRODUCT_NOT_FOUND");
  return row;
}
export async function taxonomyRow(
  tx: Tx,
  kind: TaxonomyKind,
  id: string,
  lock = false,
): Promise<TaxonomyRow> {
  const [row] = await tx<
    TaxonomyRow[]
  >`SELECT id,slug,name,revision,created_at,updated_at,archived_at FROM ${tx(tableName(kind))} WHERE id=${id} ${lock ? tx`FOR UPDATE` : tx``}`;
  if (!row) throw new StudioError("TAXONOMY_NOT_FOUND");
  return row;
}
export async function tagIds(tx: Tx, id: string): Promise<string[]> {
  const rows = await tx<
    { tag_id: string }[]
  >`SELECT tag_id FROM qf.product_tag WHERE product_id=${id} ORDER BY tag_id LIMIT 8`;
  return rows.map((r) => r.tag_id);
}
export async function hydrateProducts(
  tx: Tx,
  rows: ProductRow[],
): Promise<ProductDto[]> {
  if (!rows.length) return [];
  if (rows.length > 50) throw new StudioError("STUDIO_UNAVAILABLE");
  const ids = rows.map((r) => r.id);
  const categories = [
    ...new Set(
      rows.flatMap((r) =>
        r.primary_category_id ? [r.primary_category_id] : [],
      ),
    ),
  ];
  const categoryRows = categories.length
    ? await tx<
        TaxonomyRow[]
      >`SELECT id,slug,name,revision,created_at,updated_at,archived_at FROM qf.category WHERE id IN ${tx(categories)} LIMIT 50`
    : [];
  const tagRows = await tx<
    (TaxonomyRow & { product_id: string })[]
  >`SELECT t.id,t.slug,t.name,t.revision,t.created_at,t.updated_at,t.archived_at,pt.product_id FROM qf.product_tag pt JOIN qf.tag t ON t.id=pt.tag_id WHERE pt.product_id IN ${tx(ids)} ORDER BY t.id LIMIT 400`;
  const byCategory = new Map(categoryRows.map((r) => [r.id, summary(r)]));
  const byProduct = new Map<string, TaxonomySummary[]>();
  for (const row of tagRows)
    byProduct.set(row.product_id, [
      ...(byProduct.get(row.product_id) ?? []),
      summary(row),
    ]);
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    metadataRevision: r.metadata_revision,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    archivedAt: nullableIso(r.archived_at),
    primaryCategory: r.primary_category_id
      ? (byCategory.get(r.primary_category_id) ?? null)
      : null,
    tags: byProduct.get(r.id) ?? [],
  }));
}
export async function productDto(tx: Tx, id: string): Promise<ProductDto> {
  const [dto] = await hydrateProducts(tx, [await productRow(tx, id)]);
  if (!dto) throw new StudioError("STUDIO_UNAVAILABLE");
  return dto;
}
export async function taxonomyDto(
  tx: Tx,
  kind: TaxonomyKind,
  id: string,
): Promise<TaxonomyDto> {
  const row = await taxonomyRow(tx, kind, id);
  const [count] =
    kind === "category"
      ? await tx<
          { total: number }[]
        >`SELECT count(*)::int total FROM qf.product WHERE primary_category_id=${id}`
      : await tx<
          { total: number }[]
        >`SELECT count(*)::int total FROM qf.product_tag WHERE tag_id=${id}`;
  if (!count) throw new StudioError("STUDIO_UNAVAILABLE");
  return {
    ...summary(row),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    assignedProductCount: count.total,
  };
}
const literal = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;
const statusFilter = (
  tx: Tx,
  status: "active" | "archived" | "all",
  column: string,
) =>
  status === "all"
    ? tx`true`
    : status === "active"
      ? tx`${tx(column)} IS NULL`
      : tx`${tx(column)} IS NOT NULL`;
export async function productsPage(
  tx: Tx,
  query: ProductListQuery,
): Promise<Page<ProductDto>> {
  const q = literal(query.q ?? "");
  const filter = tx`${statusFilter(tx, query.status, "p.archived_at")}
 AND (${query.q ? tx`p.id LIKE ${q} ESCAPE ${"\\"} OR p.slug LIKE ${q} ESCAPE ${"\\"} OR p.title LIKE ${q} ESCAPE ${"\\"}` : tx`true`})
 AND (${query.categoryId ? tx`p.primary_category_id=${query.categoryId}` : tx`true`})
 AND (${query.unclassified ? tx`p.primary_category_id IS NULL` : tx`true`})
 AND (${query.tagId ? tx`EXISTS(SELECT 1 FROM qf.product_tag pt WHERE pt.product_id=p.id AND pt.tag_id=${query.tagId})` : tx`true`})`;
  const [count] = await tx<
    { total: number }[]
  >`SELECT count(*)::int total FROM qf.product p WHERE ${filter}`;
  if (!count) throw new StudioError("STUDIO_UNAVAILABLE");
  const rows = await tx<
    ProductRow[]
  >`SELECT p.id,p.slug,p.title,p.primary_category_id,p.metadata_revision,p.created_at,p.updated_at,p.archived_at FROM qf.product p WHERE ${filter} ORDER BY p.created_at DESC,p.id ASC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`;
  return {
    items: await hydrateProducts(tx, rows),
    page: query.page,
    pageSize: query.pageSize,
    total: count.total,
    hasNext: query.page * query.pageSize < count.total,
  };
}
export async function taxonomyPage(
  tx: Tx,
  kind: TaxonomyKind,
  query: TaxonomyListQuery,
): Promise<Page<TaxonomyDto>> {
  const q = literal(query.q ?? "");
  const table = tx(tableName(kind));
  const filter = tx`${statusFilter(tx, query.status, "t.archived_at")} AND (${query.q ? tx`t.slug LIKE ${q} ESCAPE ${"\\"} OR t.name LIKE ${q} ESCAPE ${"\\"}` : tx`true`}) AND (${query.slug ? tx`t.slug=${query.slug}` : tx`true`})`;
  const [count] = await tx<
    { total: number }[]
  >`SELECT count(*)::int total FROM ${table} t WHERE ${filter}`;
  if (!count) throw new StudioError("STUDIO_UNAVAILABLE");
  const assigned =
    kind === "category"
      ? tx`(SELECT count(*)::int FROM qf.product p WHERE p.primary_category_id=t.id)`
      : tx`(SELECT count(*)::int FROM qf.product_tag pt WHERE pt.tag_id=t.id)`;
  const rows = await tx<
    (TaxonomyRow & { assigned: number })[]
  >`SELECT t.id,t.slug,t.name,t.revision,t.created_at,t.updated_at,t.archived_at,${assigned} assigned FROM ${table} t WHERE ${filter} ORDER BY t.created_at DESC,t.id ASC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`;
  return {
    items: rows.map((r) => ({
      ...summary(r),
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      assignedProductCount: r.assigned,
    })),
    page: query.page,
    pageSize: query.pageSize,
    total: count.total,
    hasNext: query.page * query.pageSize < count.total,
  };
}
