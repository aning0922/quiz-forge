import { z } from "zod";
import { packIdSchema } from "@/features/quizpack/v1/manifest";

export const MAX_METADATA_REVISION = 2147483647;
export const MAX_PRODUCT_TAGS = 8;
export const productIdSchema = packIdSchema;
export const productSlugSchema = packIdSchema;
export const taxonomyIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const revisionSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_METADATA_REVISION);
const text = (max: number) =>
  z
    .string()
    .transform((v) => v.normalize("NFC").trim())
    .pipe(
      z
        .string()
        .refine(
          (v) =>
            [...v].length >= 1 &&
            [...v].length <= max &&
            !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]/u.test(v),
        ),
    );
export const titleSchema = text(120);
export const taxonomyNameSchema = text(40);
export const tagIdsSchema = z
  .array(taxonomyIdSchema)
  .max(MAX_PRODUCT_TAGS)
  .refine((v) => new Set(v).size === v.length);
const metadata = {
  slug: productSlugSchema,
  title: titleSchema,
  primaryCategoryId: taxonomyIdSchema.nullable(),
  tagIds: tagIdsSchema,
};
export const productCreateSchema = z.strictObject({
  id: productIdSchema,
  ...metadata,
});
export const productReplaceMetadataSchema = z.strictObject({
  expectedMetadataRevision: revisionSchema,
  ...metadata,
});
export const productLifecycleSchema = z.strictObject({
  expectedMetadataRevision: revisionSchema,
});
export const taxonomyCreateSchema = z.strictObject({
  slug: productSlugSchema,
  name: taxonomyNameSchema,
});
export const taxonomyRenameSchema = z.strictObject({
  expectedRevision: revisionSchema,
  name: taxonomyNameSchema,
});
export const taxonomyLifecycleSchema = z.strictObject({
  expectedRevision: revisionSchema,
});
export type ProductCreate = z.infer<typeof productCreateSchema>;
export type ProductReplaceMetadata = z.infer<
  typeof productReplaceMetadataSchema
>;
export type ProductLifecycle = z.infer<typeof productLifecycleSchema>;
export type TaxonomyCreate = z.infer<typeof taxonomyCreateSchema>;
export type TaxonomyRename = z.infer<typeof taxonomyRenameSchema>;
export type TaxonomyLifecycle = z.infer<typeof taxonomyLifecycleSchema>;
export type TaxonomyKind = "category" | "tag";
export type TaxonomySummary = {
  id: string;
  slug: string;
  name: string;
  revision: number;
  archivedAt: string | null;
};
export type TaxonomyDto = TaxonomySummary & {
  createdAt: string;
  updatedAt: string;
  assignedProductCount: number;
};
export type ProductDto = {
  id: string;
  slug: string;
  title: string;
  metadataRevision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  primaryCategory: TaxonomySummary | null;
  tags: TaxonomySummary[];
};
export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasNext: boolean;
};
export type ProductMutation = { product: ProductDto; changed: boolean };
export type TaxonomyMutation = { item: TaxonomyDto; changed: boolean };
const qSchema = z
  .string()
  .transform((v) => v.normalize("NFC").trim())
  .pipe(
    z
      .string()
      .refine(
        (v) => [...v].length <= 80 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]/u.test(v),
      ),
  );
const commonQuery = {
  page: z.number().int().min(1).max(1000).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
  status: z.enum(["active", "archived", "all"]).default("active"),
  q: qSchema.optional(),
};
export const productListQuerySchema = z
  .strictObject({
    ...commonQuery,
    categoryId: taxonomyIdSchema.optional(),
    tagId: taxonomyIdSchema.optional(),
    unclassified: z.boolean().default(false),
  })
  .refine((v) => !v.unclassified || !v.categoryId);
export const taxonomyListQuerySchema = z.strictObject({
  ...commonQuery,
  slug: productSlugSchema.optional(),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type TaxonomyListQuery = z.infer<typeof taxonomyListQuerySchema>;

/** HTTP query decoder: rejects duplicates, unknown keys and non-canonical numbers/booleans. */
export function parseWorkspaceQuery(
  params: URLSearchParams,
  kind: "product",
): ProductListQuery;
export function parseWorkspaceQuery(
  params: URLSearchParams,
  kind: "taxonomy",
): TaxonomyListQuery;
export function parseWorkspaceQuery(
  params: URLSearchParams,
  kind: "product" | "taxonomy",
) {
  const value: Record<string, unknown> = {};
  for (const [key, raw] of params) {
    if (key in value) throw new Error("INVALID_REQUEST");
    if (key === "page" || key === "pageSize") {
      if (!/^[1-9][0-9]*$/.test(raw)) throw new Error("INVALID_REQUEST");
      value[key] = Number(raw);
    } else if (key === "unclassified") {
      if (raw !== "true" && raw !== "false") throw new Error("INVALID_REQUEST");
      value[key] = raw === "true";
    } else value[key] = raw;
  }
  return (
    kind === "product" ? productListQuerySchema : taxonomyListQuerySchema
  ).parse(value);
}
