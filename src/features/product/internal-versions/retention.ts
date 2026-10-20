import "server-only";
import { z } from "zod";
import type { StorageLock } from "@/features/quizpack/import/storage-lock";
import {
  assessmentIdSchema,
  sha256Schema,
} from "@/lib/assessment-contract/primitives";
import {
  internalCanonicalText,
  type InternalReviewReceipt,
  type InternalVersionReceipt,
} from "./contracts";
import {
  verifyInternalReviewReceipt,
  verifyInternalVersionReceipt,
} from "./integrity";
import {
  reviewReceipt,
  versionDetail,
  type ReviewRow,
  type VersionRow,
} from "./repository";

const source = { productId: assessmentIdSchema };
const revision = z.strictObject({
  ...source,
  draftId: z.uuid(),
  revision: z.number().int().min(1).max(100),
});
const removalScope = z.strictObject({
  revisions: revision.array().max(1024),
  imports: z
    .strictObject({ ...source, id: z.uuid() })
    .array()
    .max(1024),
  validations: z
    .strictObject({ ...source, id: z.uuid() })
    .array()
    .max(1024),
  blobSha256: sha256Schema.array().max(192),
});
export type ReferenceRemovalScope = z.infer<typeof removalScope>;
/**
 * Called after acquiring the exclusive maintenance lock and before the FIRST unlink.
 * Only exact owned revisions may be removed. Reviews/versions are never excluded by Product.
 * The lock's own reserved connection executes one fresh READ COMMITTED statement.
 */
export async function assertNoRetainedInternalReferences(
  lock: StorageLock,
  input: ReferenceRemovalScope,
): Promise<void> {
  const scope = removalScope.parse(input);
  await lock.check();
  const [row] = await lock.query(
    () => lock.connection<
      { fresh: boolean; exclusive: boolean; retained: boolean }[]
    >`
    WITH removals AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(scope.revisions)}::text::jsonb) x("productId" text,"draftId" uuid,revision int)),
    imports AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(scope.imports)}::text::jsonb) x("productId" text,id uuid)),
    validations AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(scope.validations)}::text::jsonb) x("productId" text,id uuid)),
    affected AS (
      SELECT r.product_id,r.draft_id,r.revision,
        EXISTS(SELECT 1 FROM removals d WHERE d."productId"=r.product_id AND d."draftId"=r.draft_id AND d.revision=r.revision) AS owned
      FROM qf.draft_revision r
      WHERE EXISTS(SELECT 1 FROM removals d WHERE d."productId"=r.product_id AND d."draftId"=r.draft_id AND d.revision=r.revision)
        OR EXISTS(SELECT 1 FROM imports i WHERE i."productId"=r.product_id AND i.id=r.source_import_id)
        OR EXISTS(SELECT 1 FROM validations v WHERE v."productId"=r.product_id AND v.id=r.source_validation_id)
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.asset_set_text::jsonb->'resources') a WHERE a->>'blobSha256'=ANY(${lock.connection.array(scope.blobSha256)}::text[]))
    )
    SELECT current_setting('transaction_isolation')='read committed' AS fresh,
      EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=72461 AND objid=2 AND objsubid=2 AND mode='ExclusiveLock' AND granted) AS exclusive,
      (EXISTS(SELECT 1 FROM affected WHERE NOT owned)
       OR EXISTS(SELECT 1 FROM qf.draft_review r JOIN affected a ON (a.product_id,a.draft_id,a.revision)=(r.product_id,r.draft_id,r.revision))
       OR EXISTS(SELECT 1 FROM qf.product_version v JOIN affected a ON (a.product_id,a.draft_id,a.revision)=(v.product_id,v.draft_id,v.revision))) AS retained`,
  );
  if (row?.fresh !== true || row.exclusive !== true || row.retained !== false)
    throw new Error("INTERNAL_VERSION_REFERENCE_RETAINED");
  await lock.check();
}

/**
 * Test maintenance preflight BEFORE deleting even the fixture's own ledger.
 * The caller supplies complete, previously observed receipts, never a Product-wide exemption.
 * All review/version references to the supplied scope/blobs must be exactly these immutable facts.
 * Does not delete anything or grant a DB privilege; the caller must retain the exclusive lock.
 */
export async function assertOnlyOwnedInternalReferences(
  lock: StorageLock,
  input: ReferenceRemovalScope,
  owned: Readonly<{
    reviews: readonly InternalReviewReceipt[];
    versions: readonly InternalVersionReceipt[];
  }>,
): Promise<void> {
  const scope = removalScope.parse(input);
  const fail = () => new Error("INTERNAL_VERSION_REFERENCE_RETAINED");
  if (owned.reviews.length > 100 || owned.versions.length > 100) throw fail();
  const reviews = await Promise.all(
    owned.reviews.map(verifyInternalReviewReceipt),
  );
  const versions = await Promise.all(
    owned.versions.map(verifyInternalVersionReceipt),
  );
  for (const receipt of [...reviews, ...versions]) {
    if (
      !scope.revisions.some(
        (r) =>
          r.productId === receipt.binding.productId &&
          r.draftId === receipt.binding.target.draftId &&
          r.revision === receipt.binding.target.revision,
      )
    )
      throw fail();
  }
  await lock.check();
  const [row] = await lock.query(
    () => lock.connection<
      {
        fresh: boolean;
        exclusive: boolean;
        reviews: ReviewRow[];
        versions: VersionRow[];
      }[]
    >`
    WITH removals AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(scope.revisions)}::text::jsonb) x("productId" text,"draftId" uuid,revision int)),
    imports AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(scope.imports)}::text::jsonb) x("productId" text,id uuid)),
    validations AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(scope.validations)}::text::jsonb) x("productId" text,id uuid)),
    affected AS (
      SELECT r.product_id,r.draft_id,r.revision FROM qf.draft_revision r
      WHERE EXISTS(SELECT 1 FROM removals d WHERE d."productId"=r.product_id AND d."draftId"=r.draft_id AND d.revision=r.revision)
        OR EXISTS(SELECT 1 FROM imports i WHERE i."productId"=r.product_id AND i.id=r.source_import_id)
        OR EXISTS(SELECT 1 FROM validations v WHERE v."productId"=r.product_id AND v.id=r.source_validation_id)
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.asset_set_text::jsonb->'resources') a WHERE a->>'blobSha256'=ANY(${lock.connection.array(scope.blobSha256)}::text[]))
    )
    SELECT current_setting('transaction_isolation')='read committed' AS fresh,
      EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=72461 AND objid=2 AND objsubid=2 AND mode='ExclusiveLock' AND granted) AS exclusive,
      (SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM (SELECT r.* FROM qf.draft_review r JOIN affected a ON (a.product_id,a.draft_id,a.revision)=(r.product_id,r.draft_id,r.revision) ORDER BY r.id LIMIT 101) r) AS reviews,
      (SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]'::jsonb) FROM (SELECT v.* FROM qf.product_version v JOIN affected a ON (a.product_id,a.draft_id,a.revision)=(v.product_id,v.draft_id,v.revision) ORDER BY v.id LIMIT 101) v) AS versions`,
  );
  if (
    row?.fresh !== true ||
    row.exclusive !== true ||
    !Array.isArray(row.reviews) ||
    !Array.isArray(row.versions) ||
    row.reviews.length !== reviews.length ||
    row.versions.length !== versions.length
  )
    throw fail();
  const actualReviews = await Promise.all(row.reviews.map(reviewReceipt));
  const actualVersions = await Promise.all(
    row.versions.map(async (r) => (await versionDetail(r)).version),
  );
  for (const [expected, actual] of [
    [reviews, actualReviews],
    [versions, actualVersions],
  ] as const) {
    if (
      new Set(expected.map((r) => r.id)).size !== expected.length ||
      expected.some(
        (e) =>
          !actual.some(
            (a) =>
              a.id === e.id &&
              internalCanonicalText(a) === internalCanonicalText(e),
          ),
      )
    )
      throw fail();
  }
  await lock.check();
}
