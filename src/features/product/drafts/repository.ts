import "server-only";
import type postgres from "postgres";
import type { DatabaseTime } from "@/lib/auth/internal";
import type { StudioActor } from "@/lib/auth/capabilities";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import { iso } from "../workspace/repository";
import type { ReadyDraftSource } from "@/features/quizpack/draft-source";
import {
  draftApplicationDtoSchema,
  draftSummarySchema,
  type ApplyReadyValidation,
  type DraftApplicationDto,
  type DraftSummaryDto,
} from "./contracts";
type Tx = postgres.TransactionSql;
export type DraftRootRow = {
  id: string;
  product_id: string;
  current_revision: number;
  initial_application_id: string;
  created_by: string;
  created_at: DatabaseTime;
};
export type DraftRevisionRow = {
  product_id: string;
  draft_id: string;
  revision: number;
  application_id: string;
  source_import_id: string;
  source_validation_id: string;
  source_validation_state_revision: number;
  canonical_content_sha256: string;
  asset_set_sha256: string;
  canonical_manifest_sha256: string;
  candidate_sha256: string;
  container_schema_version: string;
  content_schema_version: string;
  content_kind: string;
  pack_id: string;
  pack_version: string;
  content_version: string;
  visual_version: string;
  report_version: string;
  resource_version: string;
  component_version: string;
  engine_id: string;
  engine_version: string;
  resource_count: number;
  created_by: string;
  created_at: DatabaseTime;
};
export type DraftRevisionBodyRow = DraftRevisionRow & {
  canonical_content_text: string;
  asset_set_text: string;
};
export type ApplicationRow = DraftRevisionRow & {
  idempotency_key: string;
  fingerprint: string;
  expected_validation_state_revision: number;
  expected_candidate_sha256: string;
  target_kind: string;
  application_created_by: string;
  application_created_at: DatabaseTime;
};
const metadataColumns = (tx: Tx) =>
  tx`r.product_id,r.draft_id,r.revision,r.application_id,r.source_import_id,r.source_validation_id,r.source_validation_state_revision,r.canonical_content_sha256,r.asset_set_sha256,r.canonical_manifest_sha256,r.candidate_sha256,r.container_schema_version,r.content_schema_version,r.content_kind,r.pack_id,r.pack_version,r.content_version,r.visual_version,r.report_version,r.resource_version,r.component_version,r.engine_id,r.engine_version,r.resource_count,r.created_by,r.created_at`;
export async function draftRoot(
  tx: Tx,
  productId: string,
): Promise<DraftRootRow | null> {
  const [row] = await tx<
    DraftRootRow[]
  >`SELECT id,product_id,current_revision,initial_application_id,created_by,created_at FROM qf.product_draft WHERE product_id=${productId}`;
  return row ?? null;
}
export async function revisionMetadata(
  tx: Tx,
  productId: string,
  draftId: string,
  revision: number,
): Promise<DraftRevisionRow | null> {
  const [row] = await tx<
    DraftRevisionRow[]
  >`SELECT ${metadataColumns(tx)} FROM qf.draft_revision r WHERE r.product_id=${productId} AND r.draft_id=${draftId} AND r.revision=${revision}`;
  return row ?? null;
}
export async function revisionBody(
  tx: Tx,
  productId: string,
  draftId: string,
  revision: number,
): Promise<DraftRevisionBodyRow | null> {
  const [row] = await tx<
    DraftRevisionBodyRow[]
  >`SELECT ${metadataColumns(tx)},r.canonical_content_text,r.asset_set_text FROM qf.draft_revision r WHERE r.product_id=${productId} AND r.draft_id=${draftId} AND r.revision=${revision}`;
  return row ?? null;
}
export async function applicationByKey(
  tx: Tx,
  productId: string,
  key: string,
): Promise<ApplicationRow | null> {
  const [row] = await tx<
    ApplicationRow[]
  >`SELECT ${metadataColumns(tx)},a.idempotency_key,a.fingerprint,a.expected_validation_state_revision,a.expected_candidate_sha256,a.target_kind,a.created_by AS application_created_by,a.created_at AS application_created_at FROM qf.draft_application a JOIN qf.draft_revision r ON r.product_id=a.product_id AND r.draft_id=a.draft_id AND r.revision=a.revision AND r.application_id=a.id WHERE a.product_id=${productId} AND a.idempotency_key=${key}`;
  return row ?? null;
}
export function summaryDto(row: DraftRevisionRow): DraftSummaryDto {
  return draftSummarySchema.parse({
    productId: row.product_id,
    draftId: row.draft_id,
    revision: row.revision,
    applicationId: row.application_id,
    sourceImportId: row.source_import_id,
    sourceValidationId: row.source_validation_id,
    canonicalContentSha256: row.canonical_content_sha256,
    assetSetSha256: row.asset_set_sha256,
    canonicalManifestSha256: row.canonical_manifest_sha256,
    candidateSha256: row.candidate_sha256,
    containerSchemaVersion: row.container_schema_version,
    contentSchemaVersion: row.content_schema_version,
    contentKind: row.content_kind,
    packId: row.pack_id,
    packVersion: row.pack_version,
    versions: {
      contentVersion: row.content_version,
      visualVersion: row.visual_version,
      reportVersion: row.report_version,
      resourceVersion: row.resource_version,
      componentVersion: row.component_version,
      engine: { id: row.engine_id, version: row.engine_version },
    },
    resourceCount: row.resource_count,
    createdAt: iso(row.created_at),
    createdBy: row.created_by,
    platformApproval: "unverified",
    publishable: false,
  });
}
export function applicationDto(row: ApplicationRow): DraftApplicationDto {
  return draftApplicationDtoSchema.parse({
    ...summaryDto(row),
    createdAt: iso(row.application_created_at),
    createdBy: row.application_created_by,
    idempotencyKey: row.idempotency_key,
    expectedValidationStateRevision: row.expected_validation_state_revision,
    expectedCandidateSha256: row.expected_candidate_sha256,
    fingerprint: row.fingerprint,
    target: { kind: row.target_kind },
  });
}
export type InsertDraft = Readonly<{
  draftId: string;
  applicationId: string;
  source: ReadyDraftSource;
  input: ApplyReadyValidation;
  fingerprint: string;
  actorId: string;
  at: DatabaseTime;
}>;
export async function insertFirstDraft(
  tx: Tx,
  value: InsertDraft,
): Promise<void> {
  const {
    source: s,
    input,
    draftId,
    applicationId,
    fingerprint,
    actorId,
    at,
  } = value;
  await tx`INSERT INTO qf.product_draft(id,product_id,current_revision,initial_application_id,created_by,created_at) VALUES(${draftId},${s.productId},1,${applicationId},${actorId},${at}::timestamptz)`;
  await tx`INSERT INTO qf.draft_revision(product_id,draft_id,revision,application_id,source_import_id,source_validation_id,source_validation_state_revision,canonical_content_text,canonical_content_sha256,asset_set_text,asset_set_sha256,canonical_manifest_sha256,candidate_sha256,container_schema_version,content_schema_version,content_kind,pack_id,pack_version,content_version,visual_version,report_version,resource_version,component_version,engine_id,engine_version,resource_count,created_by,created_at) VALUES(${s.productId},${draftId},1,${applicationId},${s.sourceImportId},${s.sourceValidationId},${s.sourceValidationStateRevision},${s.canonicalContentText},${s.canonicalContentSha256},${s.assetSetText},${s.assetSetSha256},${s.canonicalManifestSha256},${s.candidateSha256},${s.containerSchemaVersion},${s.contentSchemaVersion},${s.contentKind},${s.packId},${s.packVersion},${s.versions.contentVersion},${s.versions.visualVersion},${s.versions.reportVersion},${s.versions.resourceVersion},${s.versions.componentVersion},${s.versions.engine.id},${s.versions.engine.version},${s.resourceCount},${actorId},${at}::timestamptz)`;
  await tx`INSERT INTO qf.draft_application(id,product_id,idempotency_key,fingerprint,source_import_id,source_validation_id,expected_validation_state_revision,expected_candidate_sha256,target_kind,draft_id,revision,created_by,created_at) VALUES(${applicationId},${s.productId},${input.idempotencyKey},${fingerprint},${s.sourceImportId},${s.sourceValidationId},${input.expectedValidationStateRevision},${input.expectedCandidateSha256},'new-draft',${draftId},1,${actorId},${at}::timestamptz)`;
}
export async function auditDraftApplied(
  tx: Tx,
  actor: StudioActor,
  credentials: StudioWriteCredentials,
  eventId: string,
  draftId: string,
): Promise<void> {
  await tx`INSERT INTO qf.audit_event(id,occurred_at,action,outcome,actor_id,session_id,request_id,target_kind,target_id,target_revision) VALUES(${eventId},clock_timestamp(),'draft_applied','success',${actor.id},${actor.sessionId},${credentials.requestId},'draft',${draftId},1)`;
}
