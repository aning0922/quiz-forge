import "server-only";
import type postgres from "postgres";
import { CONSUMER_CATALOG_QUERY } from "@/lib/db/consumer-catalog";
import { consumerSchemaFacts } from "@/lib/db/consumer-schema-facts";
import type { RecoveryBudget } from "./ports";
import { checkRecoveryBudget } from "./files";
import { RecoveryError } from "./errors";

export const PG18_RESTORED_CATALOG_SHA256 =
  "a6453c24d23b26941fd461e8f04392575424cf7f7ea5463499f0696cf7186d99";

/** Original trusted IN expressions from 0010, 0014 and 0015. Never sourced from the archive. */
const originalChecks = [
  [
    "asset_blob",
    "asset_blob_media_type_check",
    "media_type IN ('image/png','image/jpeg','image/webp')",
  ],
  [
    "draft_revision",
    "draft_revision_content_kind_check",
    "content_kind IN ('synthetic','authored')",
  ],
  [
    "draft_revision",
    "draft_revision_content_schema_version_check",
    "content_schema_version IN ('quizpack-content.v1','quizpack-content.v2')",
  ],
  [
    "draft_revision",
    "draft_revision_engine_id_check",
    "engine_id IN ('dimensions','archetype')",
  ],
  [
    "product_asset",
    "product_asset_purpose_check",
    "purpose IN ('cover','portrait','decoration')",
  ],
  [
    "quizpack_validation",
    "quizpack_validation_last_error_code_check",
    `last_error_code IN (
    'VALIDATION_TIMEOUT','VALIDATION_CANCELLED','VALIDATION_LOCK_LOST','VALIDATION_RECOVERY_REQUIRED',
    'VALIDATION_STORAGE_CONFLICT','VALIDATION_SCAN_LIMIT','VALIDATION_QUOTA_EXCEEDED','VALIDATION_STATE_CONFLICT',
    'VALIDATION_IDENTITY_CHANGED','VALIDATION_REVALIDATION_REQUIRED','VALIDATION_ATTEMPT_LIMIT','VALIDATION_REJECTED',
    'PACK_IDENTITY_CONFLICT','RESOURCE_DECLARATION_CONFLICT','MEDIA_UNAVAILABLE','EVIDENCE_INVALID',
    'WRITE_OUTCOME_UNKNOWN','STUDIO_UNAVAILABLE')`,
  ],
] as const;

/** Only the new, still-pending isolated target may call this; source backup never calls it. */
export async function normalizeRestoredRecoverySchema(
  sql: postgres.Sql,
  budget: RecoveryBudget,
): Promise<void> {
  checkRecoveryBudget(budget);
  await sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL search_path=pg_catalog");
    await tx.unsafe("SET LOCAL lock_timeout='2s'");
    const [before] = await tx.unsafe<{ sha256: string }[]>(
      CONSUMER_CATALOG_QUERY,
    );
    if (before?.sha256 === consumerSchemaFacts.sha256) return;
    // The entire catalog, not a filtered projection, must be the one proven PG18.4 variant.
    if (before?.sha256 !== PG18_RESTORED_CATALOG_SHA256)
      throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
    for (const [table, name, expression] of originalChecks) {
      checkRecoveryBudget(budget);
      await tx.unsafe(
        `ALTER TABLE qf.${table} DROP CONSTRAINT ${name} RESTRICT`,
      );
      await tx.unsafe(
        `ALTER TABLE qf.${table} ADD CONSTRAINT ${name} CHECK (${expression})`,
      );
    }
    const [after] = await tx.unsafe<{ sha256: string }[]>(
      CONSUMER_CATALOG_QUERY,
    );
    if (after?.sha256 !== consumerSchemaFacts.sha256)
      throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
    checkRecoveryBudget(budget);
  });
}
