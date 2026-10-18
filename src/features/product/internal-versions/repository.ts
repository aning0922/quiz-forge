import "server-only";
import { randomUUID, createHash } from "node:crypto";
import type postgres from "postgres";
import type { DatabaseTime } from "@/lib/auth/internal";
import type { StudioActor } from "@/lib/auth/capabilities";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import { StudioError } from "@/lib/http-security/errors";
import { iso } from "../workspace/repository";
import { type DraftRevisionRow } from "../drafts/repository";
import type { ReadyDraftSourceEvidence } from "@/features/quizpack/draft-source-evidence";
import {
  recordBaselineBindingSchema,
  sealInternalVersionBindingSchema,
  recordBaselineFingerprintText,
  sealInternalVersionFingerprintText,
  reviewFactsText,
  internalSnapshotText,
  internalVersionMetadataSchema,
  type RevisionTarget,
  type RecordBaselineBinding,
  type SealInternalVersionBinding,
  type InternalReviewFacts,
  type InternalVersionSnapshot,
} from "./contracts";
import {
  verifyInternalReviewReceipt,
  verifyInternalVersionDetail,
} from "./integrity";
type Tx = postgres.TransactionSql;
type TargetRow = {
  product_id: string;
  draft_id: string;
  revision: number;
  canonical_content_sha256: string;
  asset_set_sha256: string;
  canonical_manifest_sha256: string;
};
export type ReviewRow = TargetRow & {
  id: string;
  source_import_id: string;
  source_validation_id: string;
  source_validation_state_revision: number;
  purpose: string;
  idempotency_key: string;
  binding_text: string;
  fingerprint: string;
  facts_text: string;
  review_sha256: string;
  recorded_by: string;
  recorded_at: DatabaseTime;
};
export type VersionRow = TargetRow & {
  id: string;
  slot: number;
  review_id: string;
  review_sha256: string;
  purpose: string;
  publication_approved: boolean;
  idempotency_key: string;
  binding_text: string;
  fingerprint: string;
  snapshot_text: string;
  snapshot_sha256: string;
  created_by: string;
  created_at: DatabaseTime;
};
const sha = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");
export const targetFromRevision = (
  row: DraftRevisionRow | TargetRow,
): RevisionTarget => ({
  draftId: row.draft_id,
  revision: row.revision,
  canonicalContentSha256: row.canonical_content_sha256,
  assetSetSha256: row.asset_set_sha256,
  canonicalManifestSha256: row.canonical_manifest_sha256,
});
const matchesColumns = (
  r: TargetRow,
  b: RecordBaselineBinding | SealInternalVersionBinding,
) =>
  r.product_id === b.productId &&
  r.draft_id === b.target.draftId &&
  r.revision === b.target.revision &&
  r.canonical_content_sha256 === b.target.canonicalContentSha256 &&
  r.asset_set_sha256 === b.target.assetSetSha256 &&
  r.canonical_manifest_sha256 === b.target.canonicalManifestSha256;
export async function reviewReceipt(row: ReviewRow) {
  try {
    if (
      Buffer.byteLength(row.binding_text) > 4096 ||
      Buffer.byteLength(row.facts_text) > 8192
    )
      throw 0;
    const binding = recordBaselineBindingSchema.parse(
      JSON.parse(row.binding_text),
    );
    const facts: unknown = JSON.parse(row.facts_text);
    if (
      !matchesColumns(row, binding) ||
      binding.idempotencyKey !== row.idempotency_key ||
      row.purpose !== "internal-test" ||
      recordBaselineFingerprintText(binding) !== row.binding_text ||
      reviewFactsText(facts) !== row.facts_text
    )
      throw 0;
    return await verifyInternalReviewReceipt({
      id: row.id,
      binding,
      fingerprint: row.fingerprint,
      facts,
      reviewSha256: row.review_sha256,
      recordedBy: row.recorded_by,
      recordedAt: iso(row.recorded_at),
    });
  } catch {
    throw new StudioError("STUDIO_UNAVAILABLE");
  }
}
export async function versionDetail(row: VersionRow) {
  try {
    if (
      Buffer.byteLength(row.binding_text) > 4096 ||
      Buffer.byteLength(row.snapshot_text) > 32768
    )
      throw 0;
    const binding = sealInternalVersionBindingSchema.parse(
      JSON.parse(row.binding_text),
    );
    const snapshot: unknown = JSON.parse(row.snapshot_text);
    if (
      !matchesColumns(row, binding) ||
      binding.idempotencyKey !== row.idempotency_key ||
      row.purpose !== "internal-test" ||
      row.publication_approved !== false ||
      binding.reviewId !== row.review_id ||
      binding.reviewSha256 !== row.review_sha256 ||
      sealInternalVersionFingerprintText(binding) !== row.binding_text ||
      internalSnapshotText(snapshot) !== row.snapshot_text
    )
      throw 0;
    return await verifyInternalVersionDetail({
      version: {
        id: row.id,
        slot: row.slot,
        binding,
        fingerprint: row.fingerprint,
        purpose: row.purpose,
        publicationApproved: row.publication_approved,
        snapshotSha256: row.snapshot_sha256,
        createdBy: row.created_by,
        createdAt: iso(row.created_at),
      },
      snapshot,
    });
  } catch {
    throw new StudioError("STUDIO_UNAVAILABLE");
  }
}
export async function versionMetadata(row: VersionRow) {
  const { version: v, snapshot: s } = await versionDetail(row);
  return internalVersionMetadataSchema.parse({
    id: v.id,
    productId: v.binding.productId,
    slot: v.slot,
    target: v.binding.target,
    reviewId: v.binding.reviewId,
    reviewSha256: v.binding.reviewSha256,
    snapshotSha256: v.snapshotSha256,
    renderer: v.binding.renderer,
    rendererCapability: s.rendererCapability,
    engine: v.binding.engine,
    purpose: v.purpose,
    publicationApproved: v.publicationApproved,
    createdAt: v.createdAt,
    createdBy: v.createdBy,
  });
}
export async function reviewByKey(tx: Tx, productId: string, key: string) {
  const [r] = await tx<
    ReviewRow[]
  >`SELECT * FROM qf.draft_review WHERE product_id=${productId} AND idempotency_key=${key}`;
  return r ?? null;
}
export async function reviewById(tx: Tx, productId: string, id: string) {
  const [r] = await tx<
    ReviewRow[]
  >`SELECT * FROM qf.draft_review WHERE product_id=${productId} AND id=${id}`;
  return r ?? null;
}
export async function reviewByTarget(
  tx: Tx,
  productId: string,
  target: RevisionTarget,
) {
  const [r] = await tx<
    ReviewRow[]
  >`SELECT * FROM qf.draft_review WHERE product_id=${productId} AND draft_id=${target.draftId} AND revision=${target.revision}`;
  return r ?? null;
}
export async function versionByKey(tx: Tx, productId: string, key: string) {
  const [r] = await tx<
    VersionRow[]
  >`SELECT * FROM qf.product_version WHERE product_id=${productId} AND idempotency_key=${key}`;
  return r ?? null;
}
export async function versionById(tx: Tx, productId: string, id: string) {
  const [r] = await tx<
    VersionRow[]
  >`SELECT * FROM qf.product_version WHERE product_id=${productId} AND id=${id}`;
  return r ?? null;
}
export async function versionBySnapshot(
  tx: Tx,
  productId: string,
  snapshot: string,
) {
  const [r] = await tx<
    VersionRow[]
  >`SELECT * FROM qf.product_version WHERE product_id=${productId} AND snapshot_sha256=${snapshot}`;
  return r ?? null;
}
export async function versionRows(tx: Tx, productId: string) {
  return tx<
    VersionRow[]
  >`SELECT * FROM qf.product_version WHERE product_id=${productId} ORDER BY slot DESC LIMIT 101`;
}
export async function reviewCount(tx: Tx, productId: string) {
  const [r] = await tx<
    { n: number }[]
  >`SELECT count(*)::int AS n FROM qf.draft_review WHERE product_id=${productId}`;
  if (!r || r.n < 0 || r.n > 100) throw new StudioError("STUDIO_UNAVAILABLE");
  return r.n;
}
export async function versionSlots(tx: Tx, productId: string) {
  const rows = await tx<
    { slot: number }[]
  >`SELECT slot FROM qf.product_version WHERE product_id=${productId} ORDER BY slot LIMIT 101`;
  if (
    rows.length > 100 ||
    rows.some(
      (r, i) =>
        !Number.isInteger(r.slot) ||
        r.slot < 1 ||
        r.slot > 100 ||
        (i > 0 && r.slot <= rows[i - 1]!.slot),
    )
  )
    throw new StudioError("STUDIO_UNAVAILABLE");
  return rows.map((r) => r.slot);
}
export async function insertReview(
  tx: Tx,
  binding: RecordBaselineBinding,
  facts: InternalReviewFacts,
  source: ReadyDraftSourceEvidence,
  actor: StudioActor,
) {
  const id = randomUUID(),
    b = recordBaselineFingerprintText(binding),
    f = reviewFactsText(facts),
    t = binding.target;
  const [r] = await tx<
    ReviewRow[]
  >`INSERT INTO qf.draft_review(id,product_id,draft_id,revision,canonical_content_sha256,asset_set_sha256,canonical_manifest_sha256,source_import_id,source_validation_id,source_validation_state_revision,purpose,idempotency_key,binding_text,fingerprint,facts_text,review_sha256,recorded_by,recorded_at) VALUES(${id},${binding.productId},${t.draftId},${t.revision},${t.canonicalContentSha256},${t.assetSetSha256},${t.canonicalManifestSha256},${source.sourceImportId},${source.sourceValidationId},${source.sourceValidationStateRevision},'internal-test',${binding.idempotencyKey},${b},${sha(b)},${f},${sha(f)},${actor.id},date_trunc('milliseconds',clock_timestamp())) RETURNING *`;
  if (!r) throw new StudioError("STUDIO_UNAVAILABLE");
  return reviewReceipt(r);
}
export async function insertVersion(
  tx: Tx,
  binding: SealInternalVersionBinding,
  snapshot: InternalVersionSnapshot,
  slot: number,
  actor: StudioActor,
) {
  const b = sealInternalVersionFingerprintText(binding),
    s = internalSnapshotText(snapshot),
    t = binding.target;
  const [r] = await tx<
    VersionRow[]
  >`INSERT INTO qf.product_version(id,product_id,slot,draft_id,revision,canonical_content_sha256,asset_set_sha256,canonical_manifest_sha256,review_id,review_sha256,purpose,publication_approved,idempotency_key,binding_text,fingerprint,snapshot_text,snapshot_sha256,created_by,created_at) VALUES(${randomUUID()},${binding.productId},${slot},${t.draftId},${t.revision},${t.canonicalContentSha256},${t.assetSetSha256},${t.canonicalManifestSha256},${binding.reviewId},${binding.reviewSha256},'internal-test',false,${binding.idempotencyKey},${b},${sha(b)},${s},${sha(s)},${actor.id},date_trunc('milliseconds',clock_timestamp())) RETURNING *`;
  if (!r) throw new StudioError("STUDIO_UNAVAILABLE");
  return (await versionDetail(r)).version;
}
export async function auditInternalReference(
  tx: Tx,
  actor: StudioActor,
  credentials: StudioWriteCredentials,
  kind: "review" | "version",
  id: string,
  revision: number,
) {
  const action =
    kind === "review" ? "draft_baseline_recorded" : "internal_version_sealed";
  await tx`INSERT INTO qf.audit_event(id,occurred_at,action,outcome,actor_id,session_id,request_id,target_kind,target_id,target_revision) VALUES(${randomUUID()},clock_timestamp(),${action},'success',${actor.id},${actor.sessionId},${credentials.requestId},${kind},${id},${revision})`;
}
