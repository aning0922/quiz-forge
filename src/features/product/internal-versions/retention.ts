import "server-only";
import { z } from "zod";
import type { StorageLock } from "@/features/quizpack/import/storage-lock";
import {
  assessmentIdSchema,
  sha256Schema,
} from "@/lib/assessment-contract/primitives";

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
