import "server-only";
import type postgres from "postgres";
import type { DatabaseTime } from "@/lib/auth/internal";
import type { ReadyDraftSource } from "@/features/quizpack/draft-source";
import { StudioError } from "@/lib/http-security/errors";
import { summaryDto, revisionMetadata } from "../drafts/repository";
import {
  appendDraftApplicationSchema,
  type AppendReadyValidation,
} from "./contracts";

type Tx = postgres.TransactionSql;
export type ApplicationRow = {
  id: string;
  product_id: string;
  idempotency_key: string;
  fingerprint: string;
  source_import_id: string;
  source_validation_id: string;
  expected_validation_state_revision: number;
  expected_candidate_sha256: string;
  target_kind: string;
  draft_id: string;
  revision: number;
  created_by: string;
  created_at: DatabaseTime;
  expected_draft_revision: number | null;
  expected_base_content_sha256: string | null;
  expected_base_asset_set_sha256: string | null;
};
export async function applicationByKey(
  tx: Tx,
  productId: string,
  key: string,
): Promise<ApplicationRow | null> {
  const [r] = await tx<
    ApplicationRow[]
  >`SELECT * FROM qf.draft_application WHERE product_id=${productId} AND idempotency_key=${key}`;
  return r ?? null;
}
export async function appendApplicationDto(tx: Tx, row: ApplicationRow) {
  if (row.target_kind !== "append-revision")
    throw new StudioError("IDEMPOTENCY_CONFLICT");
  const revision = await revisionMetadata(
    tx,
    row.product_id,
    row.draft_id,
    row.revision,
  );
  if (!revision || revision.application_id !== row.id)
    throw new StudioError("STUDIO_UNAVAILABLE");
  return appendDraftApplicationSchema.parse({
    ...summaryDto(revision),
    idempotencyKey: row.idempotency_key,
    expectedValidationStateRevision: row.expected_validation_state_revision,
    expectedCandidateSha256: row.expected_candidate_sha256,
    fingerprint: row.fingerprint,
    target: {
      kind: "append-revision",
      draftId: row.draft_id,
      expectedRevision: row.expected_draft_revision,
      expectedCanonicalContentSha256: row.expected_base_content_sha256,
      expectedAssetSetSha256: row.expected_base_asset_set_sha256,
    },
  });
}
export async function consumedSource(
  tx: Tx,
  productId: string,
  sourceImportId: string,
) {
  const [row] = await tx<
    { draft_id: string; revision: number; idempotency_key: string }[]
  >`SELECT draft_id,revision,idempotency_key FROM qf.draft_application WHERE product_id=${productId} AND source_import_id=${sourceImportId}`;
  return row ?? null;
}
export async function consumedManifest(
  tx: Tx,
  productId: string,
  manifest: string,
) {
  const [row] = await tx<
    { draft_id: string; revision: number; idempotency_key: string }[]
  >`SELECT r.draft_id,r.revision,a.idempotency_key FROM qf.draft_revision r JOIN qf.draft_application a ON a.product_id=r.product_id AND a.draft_id=r.draft_id AND a.revision=r.revision AND a.id=r.application_id WHERE r.product_id=${productId} AND r.canonical_manifest_sha256=${manifest}`;
  return row ?? null;
}
export async function insertAppend(
  tx: Tx,
  value: {
    source: ReadyDraftSource;
    input: AppendReadyValidation;
    applicationId: string;
    fingerprint: string;
    actorId: string;
    at: DatabaseTime;
  },
) {
  const { source: s, input, applicationId, fingerprint, actorId, at } = value,
    draftId = input.target.draftId,
    revision = input.target.expectedRevision + 1;
  await tx`INSERT INTO qf.draft_revision(product_id,draft_id,revision,application_id,source_import_id,source_validation_id,source_validation_state_revision,canonical_content_text,canonical_content_sha256,asset_set_text,asset_set_sha256,canonical_manifest_sha256,candidate_sha256,container_schema_version,content_schema_version,content_kind,pack_id,pack_version,content_version,visual_version,report_version,resource_version,component_version,engine_id,engine_version,resource_count,created_by,created_at) VALUES(${s.productId},${draftId},${revision},${applicationId},${s.sourceImportId},${s.sourceValidationId},${s.sourceValidationStateRevision},${s.canonicalContentText},${s.canonicalContentSha256},${s.assetSetText},${s.assetSetSha256},${s.canonicalManifestSha256},${s.candidateSha256},${s.containerSchemaVersion},${s.contentSchemaVersion},${s.contentKind},${s.packId},${s.packVersion},${s.versions.contentVersion},${s.versions.visualVersion},${s.versions.reportVersion},${s.versions.resourceVersion},${s.versions.componentVersion},${s.versions.engine.id},${s.versions.engine.version},${s.resourceCount},${actorId},${at}::timestamptz)`;
  await tx`INSERT INTO qf.draft_application(id,product_id,idempotency_key,fingerprint,source_import_id,source_validation_id,expected_validation_state_revision,expected_candidate_sha256,target_kind,draft_id,revision,created_by,created_at,expected_draft_revision,expected_base_content_sha256,expected_base_asset_set_sha256) VALUES(${applicationId},${s.productId},${input.idempotencyKey},${fingerprint},${s.sourceImportId},${s.sourceValidationId},${input.expectedValidationStateRevision},${input.expectedCandidateSha256},'append-revision',${draftId},${revision},${actorId},${at}::timestamptz,${input.target.expectedRevision},${input.target.expectedCanonicalContentSha256},${input.target.expectedAssetSetSha256})`;
}
export async function advanceCurrent(
  tx: Tx,
  productId: string,
  draftId: string,
  base: number,
) {
  const rows =
    await tx`UPDATE qf.product_draft SET current_revision=${base + 1} WHERE product_id=${productId} AND id=${draftId} AND current_revision=${base} RETURNING id`;
  if (rows.length !== 1) throw new StudioError("DRAFT_BASE_CONFLICT");
}
export async function historyMetadata(
  tx: Tx,
  productId: string,
  draftId: string,
  anchor: number,
  before: number,
  pageSize: number,
) {
  const numbers = await tx<
    { revision: number }[]
  >`SELECT revision FROM qf.draft_revision WHERE product_id=${productId} AND draft_id=${draftId} AND revision<=${anchor} AND revision<${before} ORDER BY revision DESC LIMIT ${pageSize}`;
  const items = [];
  for (const { revision } of numbers) {
    const row = await revisionMetadata(tx, productId, draftId, revision);
    if (!row) throw new StudioError("STUDIO_UNAVAILABLE");
    items.push(summaryDto(row));
  }
  return items;
}
