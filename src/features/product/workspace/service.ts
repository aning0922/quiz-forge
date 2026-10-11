import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { P2aDatabase } from "@/lib/db/client";
import {
  withStudioWrite,
  isStudioConnectionFailure,
  type StudioWriteCredentials,
} from "@/lib/auth/write";
import { activeActor, toActor } from "@/lib/auth/internal";
import { requireCapability, type StudioActor } from "@/lib/auth/capabilities";
import { digestToken } from "@/lib/security/p2a-tokens";
import { StudioError } from "@/lib/http-security/errors";
import {
  MAX_METADATA_REVISION,
  MAX_PRODUCT_TAGS,
  productIdSchema,
  taxonomyIdSchema,
  productCreateSchema,
  productReplaceMetadataSchema,
  productLifecycleSchema,
  taxonomyCreateSchema,
  taxonomyRenameSchema,
  taxonomyLifecycleSchema,
  productListQuerySchema,
  taxonomyListQuerySchema,
  type ProductCreate,
  type ProductReplaceMetadata,
  type ProductLifecycle,
  type TaxonomyCreate,
  type TaxonomyRename,
  type TaxonomyLifecycle,
  type ProductListQuery,
  type TaxonomyListQuery,
  type TaxonomyKind,
} from "./contracts";
import {
  productRow,
  taxonomyRow,
  tagIds,
  productDto,
  taxonomyDto,
  tableName,
  productsPage,
  taxonomyPage,
  type Tx,
} from "./repository";
import type { WorkspaceService } from "./service-contract";

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new StudioError("INVALID_REQUEST");
  return result.data;
}
function checkTagLimit(input: unknown) {
  if (
    input &&
    typeof input === "object" &&
    "tagIds" in input &&
    Array.isArray(input.tagIds) &&
    input.tagIds.length > MAX_PRODUCT_TAGS
  )
    throw new StudioError("TAG_LIMIT_EXCEEDED");
}
function revision(
  actual: number,
  expected: number,
  kind: "product" | "taxonomy",
) {
  if (actual !== expected)
    throw new StudioError(
      kind === "product"
        ? "METADATA_REVISION_CONFLICT"
        : "TAXONOMY_REVISION_CONFLICT",
      actual,
    );
}
function canIncrement(value: number) {
  if (value >= MAX_METADATA_REVISION) throw new StudioError("REVISION_LIMIT");
}
async function audit(
  tx: Tx,
  actor: StudioActor,
  requestId: string,
  kind: "product" | TaxonomyKind,
  id: string,
  value: number,
  verb: "created" | "updated" | "archived" | "restored",
) {
  await tx`INSERT INTO qf.audit_event(id,occurred_at,action,outcome,actor_id,session_id,request_id,target_kind,target_id,target_revision)
 VALUES(${randomUUID()},clock_timestamp(),${`${kind}_${verb}`},'success',${actor.id},${actor.sessionId},${requestId},${kind},${id},${value})`;
}
/** Locked union of old/new references: category UUIDs, then tag UUIDs, in ascending order. */
async function lockReferences(
  tx: Tx,
  oldCategory: string | null,
  oldTags: string[],
  newCategory: string | null,
  newTags: string[],
) {
  const categories = [
    ...new Set(
      [oldCategory, newCategory].filter((v): v is string => v !== null),
    ),
  ].sort();
  const tags = [...new Set([...oldTags, ...newTags])].sort();
  for (const id of categories) {
    const row = await taxonomyRow(tx, "category", id, true);
    if (id === newCategory && id !== oldCategory && row.archived_at !== null)
      throw new StudioError("TAXONOMY_ARCHIVED");
  }
  for (const id of tags) {
    const row = await taxonomyRow(tx, "tag", id, true);
    if (
      newTags.includes(id) &&
      !oldTags.includes(id) &&
      row.archived_at !== null
    )
      throw new StudioError("TAXONOMY_ARCHIVED");
  }
}
async function replaceTags(tx: Tx, productId: string, ids: string[]) {
  await tx`DELETE FROM qf.product_tag WHERE product_id=${productId}`;
  for (const [index, id] of [...ids].sort().entries())
    await tx`INSERT INTO qf.product_tag(product_id,tag_id,slot) VALUES(${productId},${id},${index + 1})`;
}
/** Read authorization and count/items run in one short consistent read-only snapshot. */
async function read<T>(
  database: P2aDatabase,
  raw: string | null,
  work: (tx: Tx) => Promise<T>,
): Promise<T> {
  const digest = raw ? digestToken(raw, "session") : null;
  if (!digest) throw new StudioError("UNAUTHENTICATED");
  try {
    return (await database.sql.begin(
      "isolation level repeatable read read only",
      async (tx) => {
        try {
          await tx`SET LOCAL statement_timeout = '5s'`;
          await tx`SET LOCAL transaction_timeout = '10s'`;
          const current = await activeActor(tx, digest);
          if (!current) throw new StudioError("UNAUTHENTICATED");
          requireCapability(toActor(current), "studio:read");
          return await work(tx);
        } catch (error) {
          if (isStudioConnectionFailure(error))
            await database.sql.end({ timeout: 0 }).catch(() => {});
          throw error;
        }
      },
    )) as T;
  } catch (error) {
    if (isStudioConnectionFailure(error))
      await database.sql.end({ timeout: 0 }).catch(() => {});
    if (error instanceof StudioError) throw error;
    throw new StudioError("STUDIO_UNAVAILABLE");
  }
}
export async function listProducts(
  database: P2aDatabase,
  sessionToken: string | null,
  query: ProductListQuery,
) {
  const value = parse(productListQuerySchema, query);
  return read(database, sessionToken, (tx) => productsPage(tx, value));
}
export async function readProduct(
  database: P2aDatabase,
  sessionToken: string | null,
  productId: string,
) {
  const id = parse(productIdSchema, productId);
  return read(database, sessionToken, (tx) => productDto(tx, id));
}
export async function createProduct(
  database: P2aDatabase,
  credentials: StudioWriteCredentials,
  input: ProductCreate,
) {
  checkTagLimit(input);
  const value = parse(productCreateSchema, input);
  return withStudioWrite(
    database,
    credentials,
    "workspace:write",
    async (tx, actor) => {
      // Product first, without associations. Any failure rolls the new identity back.
      await tx`WITH moment AS MATERIALIZED (SELECT clock_timestamp() at) INSERT INTO qf.product(id,slug,title,created_at,updated_at) SELECT ${value.id},${value.slug},${value.title},at,at FROM moment`;
      await lockReferences(tx, null, [], value.primaryCategoryId, value.tagIds);
      if (value.primaryCategoryId)
        await tx`UPDATE qf.product SET primary_category_id=${value.primaryCategoryId} WHERE id=${value.id}`;
      await replaceTags(tx, value.id, value.tagIds);
      await audit(
        tx,
        actor,
        credentials.requestId,
        "product",
        value.id,
        1,
        "created",
      );
      return productDto(tx, value.id);
    },
  );
}
export async function replaceProductMetadata(
  database: P2aDatabase,
  credentials: StudioWriteCredentials,
  productId: string,
  input: ProductReplaceMetadata,
) {
  checkTagLimit(input);
  const id = parse(productIdSchema, productId);
  const value = parse(productReplaceMetadataSchema, input);
  return withStudioWrite(
    database,
    credentials,
    "workspace:write",
    async (tx, actor) => {
      const row = await productRow(tx, id, true);
      revision(
        row.metadata_revision,
        value.expectedMetadataRevision,
        "product",
      );
      if (row.archived_at !== null) throw new StudioError("PRODUCT_ARCHIVED");
      const oldTags = await tagIds(tx, id);
      const newTags = [...value.tagIds].sort();
      await lockReferences(
        tx,
        row.primary_category_id,
        oldTags,
        value.primaryCategoryId,
        newTags,
      );
      const changed =
        row.slug !== value.slug ||
        row.title !== value.title ||
        row.primary_category_id !== value.primaryCategoryId ||
        oldTags.join(",") !== newTags.join(",");
      if (changed) {
        canIncrement(row.metadata_revision);
        await tx`UPDATE qf.product SET slug=${value.slug},title=${value.title},primary_category_id=${value.primaryCategoryId},metadata_revision=metadata_revision+1,updated_at=clock_timestamp() WHERE id=${id}`;
        await replaceTags(tx, id, newTags);
        await audit(
          tx,
          actor,
          credentials.requestId,
          "product",
          id,
          row.metadata_revision + 1,
          "updated",
        );
      }
      return { product: await productDto(tx, id), changed };
    },
  );
}
async function productLifecycle(
  database: P2aDatabase,
  credentials: StudioWriteCredentials,
  productId: string,
  input: ProductLifecycle,
  archived: boolean,
) {
  const id = parse(productIdSchema, productId);
  const value = parse(productLifecycleSchema, input);
  return withStudioWrite(
    database,
    credentials,
    "workspace:write",
    async (tx, actor) => {
      const row = await productRow(tx, id, true);
      revision(
        row.metadata_revision,
        value.expectedMetadataRevision,
        "product",
      );
      const changed = (row.archived_at !== null) !== archived;
      if (changed) {
        canIncrement(row.metadata_revision);
        await tx`WITH moment AS MATERIALIZED(SELECT clock_timestamp() at) UPDATE qf.product SET archived_at=${archived ? tx`moment.at` : tx`NULL`},updated_at=moment.at,metadata_revision=metadata_revision+1 FROM moment WHERE id=${id}`;
        await audit(
          tx,
          actor,
          credentials.requestId,
          "product",
          id,
          row.metadata_revision + 1,
          archived ? "archived" : "restored",
        );
      }
      return { product: await productDto(tx, id), changed };
    },
  );
}
export async function archiveProduct(
  database: P2aDatabase,
  credentials: StudioWriteCredentials,
  id: string,
  input: ProductLifecycle,
) {
  return productLifecycle(database, credentials, id, input, true);
}
export async function restoreProduct(
  database: P2aDatabase,
  credentials: StudioWriteCredentials,
  id: string,
  input: ProductLifecycle,
) {
  return productLifecycle(database, credentials, id, input, false);
}
export async function listTaxonomy(
  database: P2aDatabase,
  sessionToken: string | null,
  kind: TaxonomyKind,
  query: TaxonomyListQuery,
) {
  tableName(kind);
  const value = parse(taxonomyListQuerySchema, query);
  return read(database, sessionToken, (tx) => taxonomyPage(tx, kind, value));
}
export async function createTaxonomy(
  database: P2aDatabase,
  credentials: StudioWriteCredentials,
  kind: TaxonomyKind,
  input: TaxonomyCreate,
) {
  const table = tableName(kind);
  const value = parse(taxonomyCreateSchema, input);
  const id = randomUUID();
  return withStudioWrite(
    database,
    credentials,
    "workspace:write",
    async (tx, actor) => {
      await tx`WITH moment AS MATERIALIZED(SELECT clock_timestamp() at) INSERT INTO ${tx(table)}(id,slug,name,created_at,updated_at) SELECT ${id},${value.slug},${value.name},at,at FROM moment`;
      await audit(tx, actor, credentials.requestId, kind, id, 1, "created");
      return taxonomyDto(tx, kind, id);
    },
  );
}
export async function renameTaxonomy(
  database: P2aDatabase,
  credentials: StudioWriteCredentials,
  kind: TaxonomyKind,
  taxonomyId: string,
  input: TaxonomyRename,
) {
  const table = tableName(kind);
  const id = parse(taxonomyIdSchema, taxonomyId);
  const value = parse(taxonomyRenameSchema, input);
  return withStudioWrite(
    database,
    credentials,
    "workspace:write",
    async (tx, actor) => {
      const row = await taxonomyRow(tx, kind, id, true);
      revision(row.revision, value.expectedRevision, "taxonomy");
      if (row.archived_at !== null) throw new StudioError("TAXONOMY_ARCHIVED");
      const changed = row.name !== value.name;
      if (changed) {
        canIncrement(row.revision);
        await tx`UPDATE ${tx(table)} SET name=${value.name},revision=revision+1,updated_at=clock_timestamp() WHERE id=${id}`;
        await audit(
          tx,
          actor,
          credentials.requestId,
          kind,
          id,
          row.revision + 1,
          "updated",
        );
      }
      return { item: await taxonomyDto(tx, kind, id), changed };
    },
  );
}
async function taxonomyLifecycle(
  database: P2aDatabase,
  credentials: StudioWriteCredentials,
  kind: TaxonomyKind,
  taxonomyId: string,
  input: TaxonomyLifecycle,
  archived: boolean,
) {
  const table = tableName(kind);
  const id = parse(taxonomyIdSchema, taxonomyId);
  const value = parse(taxonomyLifecycleSchema, input);
  return withStudioWrite(
    database,
    credentials,
    "workspace:write",
    async (tx, actor) => {
      const row = await taxonomyRow(tx, kind, id, true);
      revision(row.revision, value.expectedRevision, "taxonomy");
      const changed = (row.archived_at !== null) !== archived;
      if (changed) {
        canIncrement(row.revision);
        await tx`WITH moment AS MATERIALIZED(SELECT clock_timestamp() at) UPDATE ${tx(table)} SET archived_at=${archived ? tx`moment.at` : tx`NULL`},updated_at=moment.at,revision=revision+1 FROM moment WHERE id=${id}`;
        await audit(
          tx,
          actor,
          credentials.requestId,
          kind,
          id,
          row.revision + 1,
          archived ? "archived" : "restored",
        );
      }
      return { item: await taxonomyDto(tx, kind, id), changed };
    },
  );
}
export async function archiveTaxonomy(
  database: P2aDatabase,
  credentials: StudioWriteCredentials,
  kind: TaxonomyKind,
  id: string,
  input: TaxonomyLifecycle,
) {
  return taxonomyLifecycle(database, credentials, kind, id, input, true);
}
export async function restoreTaxonomy(
  database: P2aDatabase,
  credentials: StudioWriteCredentials,
  kind: TaxonomyKind,
  id: string,
  input: TaxonomyLifecycle,
) {
  return taxonomyLifecycle(database, credentials, kind, id, input, false);
}
/** Compile-time check of the fixed milestone interface against every implementation. */
export const workspaceService = {
  listProducts,
  readProduct,
  createProduct,
  replaceProductMetadata,
  archiveProduct,
  restoreProduct,
  listTaxonomy,
  createTaxonomy,
  renameTaxonomy,
  archiveTaxonomy,
  restoreTaxonomy,
} satisfies WorkspaceService;
