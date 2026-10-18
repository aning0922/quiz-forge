import "server-only";
import type { StorageLock } from "@/features/quizpack/import/storage-lock";
import type { ReferenceRemovalScope } from "../internal-versions/retention";

/** Every current child retains its immutable play and complete source graph, including voided/expired Keys.
 * Called under the actual exclusive maintenance lock BEFORE any fixture-owned ledger DELETE or unlink.
 */
export async function assertNoConsumerReferences(
  lock: StorageLock,
  scope: ReferenceRemovalScope,
  parentVersionIds: readonly string[] = [],
): Promise<void> {
  if (parentVersionIds.length > 100) throw Error("CONSUMER_REFERENCE_RETAINED");
  await lock.check();
  const [schema] = await lock.query(
    () =>
      lock.connection<
        { present: boolean }[]
      >`SELECT to_regclass('qf.internal_play_version') IS NOT NULL AS present`,
  );
  // Explicit old-schema upgrade fixtures may not yet have 0018; production opens require all 0018 guards.
  if (schema?.present === false) return;
  const [row] = await lock.query(
    () => lock.connection<
      { fresh: boolean; exclusive: boolean; retained: boolean }[]
    >`
    WITH removals AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(scope.revisions)}::text::jsonb) x("productId" text,"draftId" uuid,revision int)),
    imports AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(scope.imports)}::text::jsonb) x("productId" text,id uuid)),
    validations AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(scope.validations)}::text::jsonb) x("productId" text,id uuid)),
    current_plays AS (
      SELECT id FROM qf.internal_play_version
      UNION SELECT play_version_id FROM qf.access_key
      UNION SELECT play_version_id FROM qf.consumer_session
      UNION SELECT play_version_id FROM qf.quiz_report
      UNION SELECT s.play_version_id FROM qf.consumer_grant g JOIN qf.consumer_session s ON(s.key_id,s.id)=(g.key_id,g.session_id)
    )
    SELECT current_setting('transaction_isolation')='read committed' AS fresh,
      EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=72461 AND objid=2 AND objsubid=2 AND mode='ExclusiveLock' AND granted) exclusive,
      EXISTS(SELECT 1 FROM current_plays c JOIN qf.internal_play_version p ON p.id=c.id
        JOIN qf.product_version v ON(v.id,v.product_id,v.snapshot_sha256)=(p.parent_version_id,p.product_id,p.parent_snapshot_sha256)
        JOIN qf.draft_revision r ON(r.product_id,r.draft_id,r.revision)=(v.product_id,v.draft_id,v.revision)
        WHERE p.parent_version_id=ANY(${lock.connection.array([...parentVersionIds])}::uuid[])
          OR EXISTS(SELECT 1 FROM removals d WHERE(d."productId",d."draftId",d.revision)=(r.product_id,r.draft_id,r.revision))
          OR EXISTS(SELECT 1 FROM imports i WHERE(i."productId",i.id)=(r.product_id,r.source_import_id))
          OR EXISTS(SELECT 1 FROM validations a WHERE(a."productId",a.id)=(r.product_id,r.source_validation_id))
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.snapshot_text::jsonb->'resources'->'resources') a WHERE a->>'blobSha256'=ANY(${lock.connection.array(scope.blobSha256)}::text[]))
      ) AS retained`,
  );
  if (row?.fresh !== true || row.exclusive !== true || row.retained !== false)
    throw Error("CONSUMER_REFERENCE_RETAINED");
  await lock.check();
}
