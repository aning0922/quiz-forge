import "server-only";
import type postgres from "postgres";
import { StudioError } from "@/lib/http-security/errors";
import {
  hydrateProducts,
  iso,
  type ProductRow,
} from "@/features/product/workspace/repository";
import type {
  OperationsQuery,
  ProductOperations,
  ImportEvidence,
  ValidationEvidence,
  DraftEvidence,
  ReviewEvidence,
  VersionEvidence,
  TestingEvidence,
} from "./contracts";
import { projectProductOperations } from "./projection";

type Tx = postgres.TransactionSql;
/** Full target equality is shared by filtering and projection source joins. */
function targetEquals(tx: Tx, left: string, right: string) {
  return tx`${tx(`${left}.draft_id`)}=${tx(`${right}.draft_id`)}
    AND ${tx(`${left}.revision`)}=${tx(`${right}.revision`)}
    AND ${tx(`${left}.canonical_content_sha256`)}=${tx(`${right}.canonical_content_sha256`)}
    AND ${tx(`${left}.asset_set_sha256`)}=${tx(`${right}.asset_set_sha256`)}
    AND ${tx(`${left}.canonical_manifest_sha256`)}=${tx(`${right}.canonical_manifest_sha256`)}`;
}
function targetJson(tx: Tx, alias: string) {
  return tx`jsonb_build_object('draftId',${tx(`${alias}.draft_id`)},'revision',${tx(`${alias}.revision`)},
    'canonicalContentSha256',${tx(`${alias}.canonical_content_sha256`)},'assetSetSha256',${tx(`${alias}.asset_set_sha256`)},'canonicalManifestSha256',${tx(`${alias}.canonical_manifest_sha256`)})`;
}
/** p is a product alias; these exact predicates are also used for dashboard counts. */
export function operationsPredicate(tx: Tx, query: OperationsQuery) {
  const q = `%${(query.q ?? "").replace(/[\\%_]/g, "\\$&")}%`;
  const hasDraft = tx`EXISTS(SELECT 1 FROM qf.product_draft d WHERE d.product_id=p.id)`;
  const hasReview = tx`EXISTS(SELECT 1 FROM qf.product_draft d JOIN qf.draft_revision r ON r.product_id=d.product_id AND r.draft_id=d.id AND r.revision=d.current_revision
    JOIN qf.draft_review rv ON rv.product_id=r.product_id AND ${targetEquals(tx, "rv", "r")} WHERE d.product_id=p.id)`;
  return tx`(${query.status === "all" ? tx`true` : query.status === "active" ? tx`p.archived_at IS NULL` : tx`p.archived_at IS NOT NULL`})
    AND (${query.q ? tx`p.id LIKE ${q} ESCAPE ${"\\"} OR p.slug LIKE ${q} ESCAPE ${"\\"} OR p.title LIKE ${q} ESCAPE ${"\\"}` : tx`true`})
    AND (${query.categoryId ? tx`p.primary_category_id=${query.categoryId}` : tx`true`})
    AND (${query.unclassified ? tx`p.primary_category_id IS NULL` : tx`true`})
    AND (${query.tagId ? tx`EXISTS(SELECT 1 FROM qf.product_tag pt WHERE pt.product_id=p.id AND pt.tag_id=${query.tagId})` : tx`true`})
    AND (${query.draft === "any" ? tx`true` : query.draft === "present" ? hasDraft : tx`NOT ${hasDraft}`})
    AND (${query.review === "any" ? tx`true` : query.review === "current" ? hasReview : tx`${hasDraft} AND NOT ${hasReview}`})`;
}
export async function operationsCount(
  tx: Tx,
  query: OperationsQuery,
): Promise<number> {
  const [row] = await tx<
    { total: number }[]
  >`SELECT count(*)::int total FROM qf.product p WHERE ${operationsPredicate(tx, query)}`;
  if (!row || !Number.isInteger(row.total) || row.total < 0)
    throw new StudioError("STUDIO_UNAVAILABLE");
  return row.total;
}
export async function operationsRows(
  tx: Tx,
  query: OperationsQuery,
): Promise<ProductRow[]> {
  return tx<
    ProductRow[]
  >`SELECT p.id,p.slug,p.title,p.primary_category_id,p.metadata_revision,p.created_at,p.updated_at,p.archived_at
    FROM qf.product p WHERE ${operationsPredicate(tx, query)} ORDER BY p.created_at DESC,p.id ASC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`;
}
export async function observationTime(tx: Tx): Promise<string> {
  const [row] = await tx<
    { as_of: Date | string }[]
  >`SELECT transaction_timestamp() as_of`;
  if (!row) throw new StudioError("STUDIO_UNAVAILABLE");
  return iso(row.as_of);
}
type Meta<T> = { product_id: string; value: T; valid: boolean };
type Collection<T> = { product_id: string; total: number; value: T };
/** Constant query count; metadata only, at most 50 products and 100 immutable records per product. */
export async function projectOperationsRows(
  tx: Tx,
  rows: ProductRow[],
  asOf: string,
): Promise<ProductOperations[]> {
  if (!rows.length) return [];
  if (rows.length > 50) throw new StudioError("STUDIO_UNAVAILABLE");
  const ids = rows.map((row) => row.id);
  const directory = await hydrateProducts(tx, rows);
  const receptions = await tx<
    Collection<ImportEvidence>[]
  >`SELECT DISTINCT ON(i.product_id) i.product_id,count(*) OVER(PARTITION BY i.product_id)::int total,
    jsonb_build_object('id',i.id,'status',i.status,'stateRevision',i.state_revision,'storageCondition',i.storage_condition,'createdAt',i.created_at) value
    FROM qf.quizpack_import i WHERE i.product_id IN ${tx(ids)} ORDER BY i.product_id,i.created_at DESC,i.id ASC LIMIT 50`;
  const validations = await tx<
    (Collection<ValidationEvidence> & { valid: boolean })[]
  >`SELECT DISTINCT ON(v.product_id) v.product_id,count(*) OVER(PARTITION BY v.product_id)::int total,
    bool_and(i.id IS NOT NULL) OVER(PARTITION BY v.product_id) valid,
    jsonb_build_object('id',v.id,'importId',v.import_id,'status',v.status,'stateRevision',v.state_revision,'storageCondition',v.storage_condition,'candidateSha256',v.candidate_sha256,'createdAt',v.created_at) value
    FROM qf.quizpack_validation v LEFT JOIN qf.quizpack_import i ON i.product_id=v.product_id AND i.id=v.import_id
    WHERE v.product_id IN ${tx(ids)} ORDER BY v.product_id,v.created_at DESC,v.id ASC LIMIT 50`;
  const drafts = await tx<Meta<DraftEvidence>[]>`SELECT d.product_id,
    (r.draft_id IS NOT NULL AND i.id IS NOT NULL AND v.id IS NOT NULL AND v.status='ready' AND v.storage_condition='clean'
      AND v.state_revision>=r.source_validation_state_revision AND v.candidate_sha256=r.candidate_sha256
      AND v.canonical_content_sha256=r.canonical_content_sha256 AND v.asset_set_sha256=r.asset_set_sha256 AND v.canonical_manifest_sha256=r.canonical_manifest_sha256) valid,
    jsonb_build_object('target',${targetJson(tx, "r")},'sourceImportId',r.source_import_id,'sourceValidationId',r.source_validation_id,'sourceValidationStateRevision',r.source_validation_state_revision,'candidateSha256',r.candidate_sha256,'createdAt',r.created_at) value
    FROM qf.product_draft d LEFT JOIN qf.draft_revision r ON r.product_id=d.product_id AND r.draft_id=d.id AND r.revision=d.current_revision
    LEFT JOIN qf.quizpack_import i ON i.product_id=r.product_id AND i.id=r.source_import_id
    LEFT JOIN qf.quizpack_validation v ON v.product_id=r.product_id AND v.import_id=r.source_import_id AND v.id=r.source_validation_id
    WHERE d.product_id IN ${tx(ids)} ORDER BY d.product_id LIMIT 50`;
  const reviews = await tx<Meta<ReviewEvidence>[]>`SELECT rv.product_id,
    (r.draft_id IS NOT NULL AND rv.purpose='internal-test' AND rv.source_import_id=r.source_import_id AND rv.source_validation_id=r.source_validation_id AND rv.source_validation_state_revision=r.source_validation_state_revision AND qf.internal_review_valid(rv)) valid,
    jsonb_build_object('id',rv.id,'target',${targetJson(tx, "rv")},'reviewSha256',rv.review_sha256,'sourceImportId',rv.source_import_id,'sourceValidationId',rv.source_validation_id,'sourceValidationStateRevision',rv.source_validation_state_revision,'baseline',rv.facts_text::jsonb->'baseline','approval',rv.facts_text::jsonb->'approval','recordedAt',rv.recorded_at) value
    FROM qf.draft_review rv LEFT JOIN qf.draft_revision r ON r.product_id=rv.product_id AND ${targetEquals(tx, "rv", "r")}
    WHERE rv.product_id IN ${tx(ids)} ORDER BY rv.recorded_at DESC,rv.id ASC LIMIT 5001`;
  const versions = await tx<Meta<VersionEvidence>[]>`SELECT pv.product_id,
    (rv.id IS NOT NULL AND pv.purpose='internal-test' AND pv.publication_approved=false AND pv.snapshot_sha256=qf.sha256_utf8(pv.snapshot_text)) valid,
    jsonb_build_object('id',pv.id,'target',${targetJson(tx, "pv")},'reviewId',pv.review_id,'reviewSha256',pv.review_sha256,'snapshotSha256',pv.snapshot_sha256,'createdAt',pv.created_at) value
    FROM qf.product_version pv LEFT JOIN qf.draft_review rv ON rv.product_id=pv.product_id AND rv.id=pv.review_id AND rv.review_sha256=pv.review_sha256 AND ${targetEquals(tx, "pv", "rv")}
    WHERE pv.product_id IN ${tx(ids)} ORDER BY pv.created_at DESC,pv.id ASC LIMIT 5001`;
  const testing = await tx<Meta<TestingEvidence>[]>`SELECT play.product_id,
    (pv.id IS NOT NULL AND play.snapshot_sha256=qf.sha256_utf8(play.snapshot_text)) valid,
    jsonb_build_object('id',play.id,'parentVersionId',play.parent_version_id,'parentSnapshotSha256',play.parent_snapshot_sha256,'snapshotSha256',play.snapshot_sha256,'target',${targetJson(tx, "pv")},'createdAt',play.created_at) value
    FROM qf.internal_play_version play LEFT JOIN qf.product_version pv ON pv.product_id=play.product_id AND pv.id=play.parent_version_id AND pv.snapshot_sha256=play.parent_snapshot_sha256
    WHERE play.product_id IN ${tx(ids)} ORDER BY play.created_at DESC,play.id ASC LIMIT 5001`;
  for (const group of [drafts, reviews, versions, testing])
    if (group.length > 5000 || group.some((row) => row.valid !== true))
      throw new StudioError("STUDIO_UNAVAILABLE");
  if (validations.some((row) => row.valid !== true))
    throw new StudioError("STUDIO_UNAVAILABLE");
  const group = <T>(values: Meta<T>[], id: string) =>
    values.filter((row) => row.product_id === id).map((row) => row.value);
  return directory.map((product) => {
    const reception = receptions.find((row) => row.product_id === product.id),
      validation = validations.find((row) => row.product_id === product.id);
    return projectProductOperations(product, asOf, {
      reception: {
        total: reception?.total ?? 0,
        latest: reception?.value ?? null,
      },
      validation: {
        total: validation?.total ?? 0,
        latest: validation?.value ?? null,
      },
      draft: group(drafts, product.id)[0] ?? null,
      reviews: group(reviews, product.id),
      versions: group(versions, product.id),
      testing: group(testing, product.id),
    });
  });
}
