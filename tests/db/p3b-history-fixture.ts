import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { readMigrations } from "@/lib/db/migrate";
import { createDatabase } from "@/lib/db/client";
import { serializeEvidenceSqlProjection } from "@/features/quizpack/server/validation/sql-projection";
import {
  validationKey,
  serializeValidationAttempts,
  type ValidationRow,
  type ValidationAttempt,
} from "@/features/quizpack/validation/repository";
import { insertFirstDraft } from "@/features/product/drafts/repository";
import { draftApplicationFingerprint } from "@/features/product/drafts/contracts";
import type { ReadyDraftSource } from "@/features/quizpack/draft-source";
import type { DatabaseTime } from "@/lib/auth/internal";
import { syntheticFileStopProof, hash } from "./p2b2b-domain-fixture";
import type { PreparedP2b3Source } from "./p2b3-fixture";
import type { TestDatabase, authenticateTestOperator } from "./p2a-fixture";

/** Explicit historical SQL fixture: real old guards and transitions, synthetic no-file evidence.
 * Restore functions only inside a transaction, then re-run actual 0015 including quiescence checks.
 * No trigger/constraint disabling and no table/history/checksum edits. */
export async function historicalTransaction<T>(
  db: TestDatabase,
  work: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  if (db.config.purpose !== "test" && db.config.purpose !== "ci")
    throw Error("P3B_PURPOSE_TEST_REQUIRED");
  const migrations = await readMigrations();
  const old = migrations
    .filter((m) => m.version < "0015")
    .map((m) => m.source)
    .join("\n");
  const definitions = [
    "protect_validation",
    "validation_shape_valid",
    "validation_file_stop_controls_valid",
    "protect_validation_file_stop_ack",
    "protect_draft_revision_source",
  ]
    .map((name) => {
      const matches = [
        ...old.matchAll(
          new RegExp(
            "CREATE(?: OR REPLACE)? FUNCTION qf\\." + name + "\\(.*?\\$\\$;",
            "gs",
          ),
        ),
      ];
      const source = matches.at(-1)?.[0];
      if (!source) throw Error("P3B_OLD_HELPER_REQUIRED");
      return source.replace(/^CREATE FUNCTION/, "CREATE OR REPLACE FUNCTION");
    })
    .join("\n");
  await db.app.close();
  try {
    let completed: { value: T } | undefined;
    await db.admin.sql.begin(async (tx) => {
      await tx.unsafe(definitions);
      const value = await work(tx);
      await tx`SET CONSTRAINTS ALL IMMEDIATE`;
      const migration = migrations.find(
        (m) => m.version === "0015_supported_pack_admission",
      );
      if (!migration) throw Error("P3B_MIGRATION_REQUIRED");
      await tx.unsafe(migration.source);
      completed = { value };
    });
    if (!completed) throw Error("P3B_HISTORY_TRANSACTION_REQUIRED");
    return completed.value;
  } finally {
    db.app = await createDatabase(db.config);
  }
}
export async function seedLegacySource(
  tx: postgres.TransactionSql,
  auth: Awaited<ReturnType<typeof authenticateTestOperator>>,
  p: PreparedP2b3Source,
  mode: "ready" | "validated" | "retryable-failed" = "ready",
) {
  if (p.archivePolicyVersion !== "quizpack-private-archive.v2")
    throw Error("P3B_LEGACY_PREPARATION_REQUIRED");
  const { productId, archiveSha256, archiveBytes } = p,
    importId = randomUUID(),
    id = randomUUID();
  const b = {
    identityText: p.identityText,
    identitySha256: p.identitySha256,
    archivePolicyVersion: p.archivePolicyVersion,
    archivePolicySha256: p.archivePolicySha256,
    validationKey: validationKey({
      productId,
      importId,
      archiveSha256,
      archiveBytes,
      identitySha256: p.identitySha256,
      archivePolicyVersion: p.archivePolicyVersion,
      archivePolicySha256: p.archivePolicySha256,
    }),
  };
  await tx`INSERT INTO qf.product(id,slug,title,updated_at) VALUES(${productId},${productId},'Explicit historical no-file SQL fixture',clock_timestamp()) ON CONFLICT(id) DO NOTHING`;
  await tx`INSERT INTO qf.quizpack_import(id,product_id,created_by,idempotency_key,request_fingerprint,expected_archive_sha256,expected_archive_bytes,target_kind,created_at,status,state_revision,updated_at,storage_condition,fence,attempts,actual_archive_sha256,actual_archive_bytes,archive_storage_key,received_at) VALUES(${importId},${productId},${auth.id},${randomUUID()},${hash("Synthetic historical request")},${archiveSha256},${archiveBytes},'new-draft',clock_timestamp(),'received',1,clock_timestamp(),'clean',0,'[]',${archiveSha256},${archiveBytes},${`imports/${importId}/archive.quizpack`},clock_timestamp())`;
  const a: ValidationAttempt = {
    attemptId: randomUUID(),
    ordinal: 1,
    fence: 1,
    ownerPid: process.pid,
    ownerNonce: "a".repeat(43),
    kind: "validate",
    reservationBytes: 134283264,
    disposition: "held",
    mediaStop: "unconfirmed",
    fileStopProof: null,
  };
  const [initial] = await tx<
    ValidationRow[]
  >`INSERT INTO qf.quizpack_validation(id,product_id,import_id,created_by,created_at,validation_key,archive_sha256,archive_bytes,identity_text,identity_sha256,archive_policy_version,archive_policy_sha256,status,state_revision,updated_at,fence,lease_until,current_attempt_id,attempts_text,storage_condition,reserved_bytes,accounted_bytes,identity_kind) VALUES(${id},${productId},${importId},${auth.id},clock_timestamp(),${b.validationKey},${archiveSha256},${archiveBytes},${b.identityText},${b.identitySha256},${b.archivePolicyVersion},${b.archivePolicySha256},'validating',1,clock_timestamp(),1,clock_timestamp()+interval '120 seconds',${a.attemptId},${serializeValidationAttempts([a])},'unknown',134283264,0,'unclaimed') RETURNING *`;
  if (!initial) throw Error("P3B_LEGACY_CLAIM_REQUIRED");
  const { facts: f } = p.candidate;
  if (mode !== "retryable-failed") {
    const controls = serializeValidationAttempts([
      { ...a, mediaStop: "confirmed" },
    ]);
    const projection = serializeEvidenceSqlProjection(
      {
        schemaVersion: "quizpack-evidence-envelope.v1",
        attempts: [{ attempt: 1, result: p.result }],
      },
      controls,
    );
    if (!projection.ok) throw Error("P3B_LEGACY_PROJECTION_REQUIRED");
    const e = projection.value;
    await tx`UPDATE qf.quizpack_validation SET status='validated',state_revision=state_revision+1,updated_at=clock_timestamp(),attempts_text=${controls},evidence_text=${e.evidenceText},evidence_sha256=${e.evidenceSha256},report_texts=${tx.array([...e.reportTexts])},evidence_metadata_text=${e.metadataText},pack_id=${f.packId},pack_version=${f.packVersion},container_schema_version=${f.manifest.schemaVersion},content_schema_version=${f.content.schemaVersion},content_kind=${f.content.kind},manifest_sha256=${p.candidate.manifestSha256},content_sha256=${p.candidate.contentSha256},canonical_manifest_text=${f.canonicalManifestText},canonical_manifest_sha256=${f.canonicalManifestSha256},canonical_content_text=${f.canonicalContentText},canonical_content_sha256=${f.canonicalContentSha256},asset_set_text=${f.assetSetText},asset_set_sha256=${f.assetSetSha256},candidate_sha256=${f.candidateSha256},resource_count=${f.resources.length},identity_kind='canonical',validated_at=clock_timestamp() WHERE id=${id}`;
  }
  const mediaStop = mode === "retryable-failed" ? "not-started" : "confirmed";
  const ack = serializeValidationAttempts([
    {
      ...a,
      mediaStop,
      fileStopProof: syntheticFileStopProof(initial, mediaStop),
    },
  ]);
  await tx`UPDATE qf.quizpack_validation SET attempts_text=${ack},state_revision=state_revision+1,updated_at=clock_timestamp() WHERE id=${id}`;
  if (mode === "ready") {
    await tx`UPDATE qf.quizpack_validation SET status='archiving',state_revision=state_revision+1,updated_at=clock_timestamp() WHERE id=${id}`;
    for (const r of f.resources) {
      const d = r.declaration;
      await tx`INSERT INTO qf.asset_blob(sha256,bytes,media_type,width,height,frames,storage_key,created_at) VALUES(${r.blobSha256},${r.bytes},${d.mediaType},${d.width},${d.height},1,${`blobs/${r.blobSha256}.blob`},clock_timestamp()) ON CONFLICT(sha256) DO NOTHING`;
      await tx`INSERT INTO qf.product_asset(product_id,resource_id,resource_version,blob_sha256,declaration_text,declaration_sha256,purpose,source_validation_id,platform_approval,created_at) VALUES(${productId},${d.id},${d.version},${r.blobSha256},${r.canonicalDeclarationText},${r.declarationSha256},${d.purpose},${id},'unverified',clock_timestamp())`;
    }
  }
  const released = serializeValidationAttempts([
    {
      ...a,
      mediaStop,
      disposition: "released",
      fileStopProof: syntheticFileStopProof(initial, mediaStop),
    },
  ]);
  const [row] = await tx<
    ValidationRow[]
  >`UPDATE qf.quizpack_validation SET status=${mode},state_revision=state_revision+1,updated_at=clock_timestamp(),lease_until=NULL,attempts_text=${released},reserved_bytes=0,storage_condition='clean',last_error_code=${mode === "retryable-failed" ? "VALIDATION_CANCELLED" : null},ready_at=${mode === "ready" ? tx`clock_timestamp()` : tx`NULL`} WHERE id=${id} RETURNING *`;
  if (!row) throw Error("P3B_LEGACY_ROW_REQUIRED");
  return {
    row,
    scope: { productId, sourceImportId: importId, sourceValidationId: id },
    binding: b,
    input: {
      idempotencyKey: randomUUID(),
      expectedValidationStateRevision: row.state_revision,
      expectedCandidateSha256: f.candidateSha256,
      target: { kind: "new-draft" as const },
    },
  };
}
export async function seedLegacyDraft(
  tx: postgres.TransactionSql,
  auth: Awaited<ReturnType<typeof authenticateTestOperator>>,
  p: PreparedP2b3Source,
  s: Awaited<ReturnType<typeof seedLegacySource>>,
) {
  const { content } = p.candidate.facts;
  const source: ReadyDraftSource = {
    ...s.scope,
    sourceValidationStateRevision: s.row.state_revision,
    canonicalContentText: s.row.canonical_content_text!,
    canonicalContentSha256: s.row.canonical_content_sha256!,
    assetSetText: s.row.asset_set_text!,
    assetSetSha256: s.row.asset_set_sha256!,
    canonicalManifestSha256: s.row.canonical_manifest_sha256!,
    candidateSha256: s.row.candidate_sha256!,
    containerSchemaVersion: "quizpack.v1",
    contentSchemaVersion: "quizpack-content.v1",
    contentKind: "synthetic",
    packId: s.row.pack_id!,
    packVersion: s.row.pack_version!,
    resourceCount: s.row.resource_count!,
    versions: {
      contentVersion: content.contentVersion,
      visualVersion: content.visualVersion,
      reportVersion: content.reportVersion,
      resourceVersion: content.resourceVersion,
      componentVersion: content.componentVersion,
      engine: content.engine,
    },
  };
  const [moment] = await tx<
    { at: DatabaseTime }[]
  >`SELECT date_trunc('milliseconds',clock_timestamp())::text AS at`;
  if (!moment) throw Error("P3B_LEGACY_TIME_REQUIRED");
  const draftId = randomUUID();
  await insertFirstDraft(tx, {
    draftId,
    applicationId: randomUUID(),
    source,
    input: s.input,
    fingerprint: await draftApplicationFingerprint({
      ...s.scope,
      expectedValidationStateRevision: s.input.expectedValidationStateRevision,
      expectedCandidateSha256: s.input.expectedCandidateSha256,
      target: s.input.target,
    }),
    actorId: auth.id,
    at: moment.at,
  });
  return draftId;
}
