import "server-only";
import { randomUUID } from "node:crypto";
import { withStudioWrite, type StudioWriteCredentials } from "@/lib/auth/write";
import type { P2aDatabase } from "@/lib/db/client";
import { StudioError } from "@/lib/http-security/errors";
import type { StudioActor } from "@/lib/auth/capabilities";
import { productRow, type Tx } from "@/features/product/workspace/repository";
import { importRow } from "../import/repository";
import { canonicalP1Json } from "../v1/canonical";
import { validationIdentitySchema } from "../server/validation/contracts";
import {
  MAX_ATTEMPTS,
  MAX_PENDING_VALIDATIONS,
  MAX_REVISION,
  MAX_VALIDATIONS,
  MAX_METADATA_BYTES,
  VALIDATION_RESERVATION_BYTES,
} from "./limits";
import { ARCHIVE_POLICY_VERSION, archivePolicySha256 } from "./policy";
import {
  exactValidation,
  parseValidationAttempts,
  serializeValidationAttempts,
  validationKey,
  validationRow,
  validationFileStopProofSchema,
  type ValidationAttempt,
  type ValidationRow,
  type ValidationBinding,
} from "./repository";
import type {
  AppendEvidenceInput,
  AcknowledgeValidationFileStopInput,
  ClaimValidationInput,
  CompleteValidationInput,
  ReconcileValidationInput,
  RetryValidationInput,
  ValidationAuthority,
  ValidationScope,
  ValidationTransactions,
} from "./transactions-contract";
async function audit(
  tx: Tx,
  actor: StudioActor,
  credentials: StudioWriteCredentials,
  row: ValidationRow,
  action:
    | "started"
    | "evidenced"
    | "rejected"
    | "interrupted"
    | "completed"
    | "recovered"
    | "retried"
    | "file_stop_acknowledged",
) {
  await tx`INSERT INTO qf.audit_event(id,occurred_at,action,outcome,actor_id,session_id,request_id,target_kind,target_id,target_revision) VALUES(${randomUUID()},clock_timestamp(),${`validation_${action}`},'success',${actor.id},${actor.sessionId},${credentials.requestId},'validation',${row.id},${row.state_revision})`;
}
function increment(row: ValidationRow, fence = false) {
  if (
    row.state_revision >= MAX_REVISION ||
    (fence && row.fence >= MAX_REVISION)
  )
    throw new StudioError("REVISION_LIMIT");
}
function requireCurrentPolicy(row: ValidationRow) {
  if (
    row.archive_policy_version !== ARCHIVE_POLICY_VERSION ||
    row.archive_policy_sha256 !== archivePolicySha256
  )
    throw new StudioError("VALIDATION_REVALIDATION_REQUIRED");
}
function requireAcknowledgedAttempts(row: ValidationRow) {
  requireCurrentPolicy(row);
  const attempts = parseValidationAttempts(row.attempts_text);
  if (attempts.some((a) => !a.fileStopProof || a.mediaStop === "unconfirmed"))
    throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
  return attempts;
}
async function scopeRows(tx: Tx, scope: ValidationScope, active = true) {
  const product = await productRow(tx, scope.productId, true);
  if (active && product.archived_at !== null)
    throw new StudioError("PRODUCT_ARCHIVED");
  const original = await importRow(tx, scope.productId, scope.importId, true);
  if (
    original.status !== "received" ||
    original.actual_archive_sha256 === null ||
    original.actual_archive_bytes === null
  )
    throw new StudioError("IMPORT_STATE_CONFLICT", original.state_revision);
  return { product, original };
}
function verifyBinding(
  binding: ValidationBinding,
  scope: ValidationScope,
  archiveSha256: string,
  archiveBytes: number,
) {
  try {
    const identity = validationIdentitySchema.parse(
      JSON.parse(binding.identityText),
    );
    if (
      canonicalP1Json(identity) !== binding.identityText ||
      identity.identitySha256 !== binding.identitySha256 ||
      binding.archivePolicyVersion !== ARCHIVE_POLICY_VERSION ||
      binding.archivePolicySha256 !== archivePolicySha256 ||
      binding.validationKey !==
        validationKey({
          ...scope,
          archiveSha256,
          archiveBytes,
          identitySha256: binding.identitySha256,
          archivePolicyVersion: binding.archivePolicyVersion,
          archivePolicySha256: binding.archivePolicySha256,
        })
    )
      throw new Error("Invalid binding");
  } catch {
    throw new StudioError("VALIDATION_IDENTITY_CHANGED");
  }
}
async function authorityRow(
  tx: Tx,
  scope: ValidationScope,
  authority: ValidationAuthority,
  lease = true,
) {
  await scopeRows(tx, scope);
  const row = await validationRow(
    tx,
    scope.productId,
    scope.importId,
    authority.validationId,
    true,
  );
  if (
    row.state_revision !== authority.expectedStateRevision ||
    row.fence !== authority.fence ||
    row.current_attempt_id !== authority.attemptId
  )
    throw new StudioError("VALIDATION_STATE_CONFLICT", row.state_revision);
  increment(row);
  if (lease) {
    const [fact] = await tx<
      { live: boolean }[]
    >`SELECT lease_until>clock_timestamp() AS live FROM qf.quizpack_validation WHERE id=${row.id}`;
    if (fact?.live !== true) throw new StudioError("VALIDATION_LOCK_LOST");
  }
  return row;
}
function nextAttempt(
  row: ValidationRow | null,
  owner: ClaimValidationInput["owner"],
  kind: "validate" | "archive",
): ValidationAttempt {
  return {
    attemptId: randomUUID(),
    ordinal: row ? parseValidationAttempts(row.attempts_text).length + 1 : 1,
    fence: row ? row.fence + 1 : 1,
    ownerPid: owner.ownerPid,
    ownerNonce: owner.ownerNonce,
    kind,
    reservationBytes: VALIDATION_RESERVATION_BYTES,
    disposition: "held",
    mediaStop: kind === "validate" ? "unconfirmed" : "not-started",
    fileStopProof: null,
  };
}
async function countCapacity(tx: Tx, productId: string) {
  const pending = await tx<
    { id: string }[]
  >`SELECT id FROM qf.quizpack_validation WHERE product_id=${productId} AND (status NOT IN ('ready','rejected') OR storage_condition<>'clean' OR reserved_bytes>0) ORDER BY id LIMIT ${MAX_PENDING_VALIDATIONS + 1}`;
  if (pending.length >= MAX_PENDING_VALIDATIONS)
    throw new StudioError("VALIDATION_PENDING_LIMIT");
  const all = await tx<
    { id: string }[]
  >`SELECT id FROM qf.quizpack_validation ORDER BY id LIMIT ${MAX_VALIDATIONS + 1}`;
  if (all.length >= MAX_VALIDATIONS)
    throw new StudioError("VALIDATION_SCAN_LIMIT");
}
export async function claimValidation(
  db: P2aDatabase,
  credentials: StudioWriteCredentials,
  scope: ValidationScope,
  input: ClaimValidationInput,
) {
  return withStudioWrite(
    db,
    credentials,
    "import:create",
    async (tx, actor) => {
      const { product, original } = await scopeRows(tx, scope, false);
      const existing = await exactValidation(
        tx,
        scope.productId,
        scope.importId,
        input.expectedValidationKey,
        true,
      );
      if (existing) return { row: existing, created: false };
      if (product.archived_at !== null)
        throw new StudioError("PRODUCT_ARCHIVED");
      if (original.state_revision !== input.expectedImportStateRevision)
        throw new StudioError("IMPORT_STATE_CONFLICT", original.state_revision);
      verifyBinding(
        input.binding,
        scope,
        original.actual_archive_sha256!,
        original.actual_archive_bytes!,
      );
      if (input.binding.validationKey !== input.expectedValidationKey)
        throw new StudioError("VALIDATION_IDENTITY_CHANGED");
      await countCapacity(tx, scope.productId);
      const attempt = nextAttempt(null, input.owner, "validate");
      const controls = serializeValidationAttempts([attempt]);
      const [row] = await tx<
        ValidationRow[]
      >`INSERT INTO qf.quizpack_validation(id,product_id,import_id,created_by,created_at,validation_key,archive_sha256,archive_bytes,identity_text,identity_sha256,archive_policy_version,archive_policy_sha256,status,state_revision,updated_at,fence,lease_until,current_attempt_id,attempts_text,storage_condition,reserved_bytes,accounted_bytes,identity_kind) VALUES(${randomUUID()},${scope.productId},${scope.importId},${actor.id},clock_timestamp(),${input.expectedValidationKey},${original.actual_archive_sha256},${original.actual_archive_bytes},${input.binding.identityText},${input.binding.identitySha256},${input.binding.archivePolicyVersion},${input.binding.archivePolicySha256},'validating',1,clock_timestamp(),1,clock_timestamp()+interval '120 seconds',${attempt.attemptId},${controls},'unknown',${VALIDATION_RESERVATION_BYTES},0,'unclaimed') RETURNING *`;
      if (!row) throw new StudioError("STUDIO_UNAVAILABLE");
      await audit(tx, actor, credentials, row, "started");
      return { row, created: true };
    },
  );
}
export async function appendValidationEvidence(
  db: P2aDatabase,
  credentials: StudioWriteCredentials,
  scope: ValidationScope,
  input: AppendEvidenceInput,
) {
  return withStudioWrite(
    db,
    credentials,
    "import:create",
    async (tx, actor) => {
      const current = await authorityRow(tx, scope, input.authority);
      requireCurrentPolicy(current);
      if (
        input.projection.metadataText !== null &&
        Buffer.byteLength(input.projection.metadataText, "utf8") >
          MAX_METADATA_BYTES
      )
        throw new StudioError("EVIDENCE_INVALID");
      if (current.status !== "validating" || current.validated_at !== null)
        throw new StudioError(
          "VALIDATION_STATE_CONFLICT",
          current.state_revision,
        );
      const attempts = parseValidationAttempts(current.attempts_text).map(
        (a) =>
          a.attemptId === current.current_attempt_id
            ? { ...a, mediaStop: input.mediaStop }
            : a,
      );
      const controls = serializeValidationAttempts(attempts);
      if (controls !== input.projection.attemptsControlText)
        throw new StudioError("EVIDENCE_INVALID");
      const c = input.candidate;
      let identityKind: ValidationRow["identity_kind"] = "unclaimed";
      let canonicalId: string | null = null;
      let status: ValidationRow["status"] =
        input.outcome === "accepted"
          ? "validated"
          : input.outcome === "rejected"
            ? "rejected"
            : "retryable-failed";
      let error = input.errorCode;
      if ((input.outcome === "accepted") !== (c !== null))
        throw new StudioError("EVIDENCE_INVALID");
      if (c) {
        const f = c.facts;
        if (
          f.productId !== scope.productId ||
          f.archiveSha256 !== current.archive_sha256
        )
          throw new StudioError("EVIDENCE_INVALID");
        const [canonical] = await tx<
          ValidationRow[]
        >`SELECT * FROM qf.quizpack_validation WHERE product_id=${scope.productId} AND pack_id=${f.packId} AND pack_version=${f.packVersion} AND identity_kind='canonical' FOR UPDATE`;
        if (!canonical) identityKind = "canonical";
        else if (
          canonical.archive_sha256 === current.archive_sha256 &&
          canonical.archive_bytes === current.archive_bytes
        ) {
          identityKind = "alias";
          canonicalId = canonical.id;
        } else {
          identityKind = "conflict";
          status = "rejected";
          error = "PACK_IDENTITY_CONFLICT";
        }
        if (identityKind !== "conflict")
          for (const resource of f.resources) {
            const d = resource.declaration;
            const [existing] = await tx<
              {
                blob_sha256: string;
                declaration_sha256: string;
                declaration_text: string;
              }[]
            >`SELECT blob_sha256,declaration_sha256,declaration_text FROM qf.product_asset WHERE product_id=${scope.productId} AND resource_id=${d.id} AND resource_version=${d.version}`;
            if (
              existing &&
              (existing.blob_sha256 !== resource.blobSha256 ||
                existing.declaration_sha256 !== resource.declarationSha256 ||
                existing.declaration_text !== resource.canonicalDeclarationText)
            ) {
              status = "rejected";
              error = "RESOURCE_DECLARATION_CONFLICT";
            }
          }
      }
      const [row] = await tx<
        ValidationRow[]
      >`UPDATE qf.quizpack_validation SET status=${status},state_revision=state_revision+1,updated_at=clock_timestamp(),attempts_text=${controls},evidence_text=${input.projection.evidenceText},evidence_sha256=${input.projection.evidenceSha256},report_texts=${tx.array([...input.projection.reportTexts])},evidence_metadata_text=${input.projection.metadataText},last_error_code=${error},pack_id=${c?.facts.packId ?? null},pack_version=${c?.facts.packVersion ?? null},container_schema_version=${c?.facts.manifest.schemaVersion ?? null},content_schema_version=${c?.facts.content.schemaVersion ?? null},content_kind=${c?.facts.content.kind ?? null},manifest_sha256=${c?.manifestSha256 ?? null},content_sha256=${c?.contentSha256 ?? null},canonical_manifest_text=${c?.facts.canonicalManifestText ?? null},canonical_manifest_sha256=${c?.facts.canonicalManifestSha256 ?? null},canonical_content_text=${c?.facts.canonicalContentText ?? null},canonical_content_sha256=${c?.facts.canonicalContentSha256 ?? null},asset_set_text=${c?.facts.assetSetText ?? null},asset_set_sha256=${c?.facts.assetSetSha256 ?? null},candidate_sha256=${c?.facts.candidateSha256 ?? null},resource_count=${c?.facts.resources.length ?? null},identity_kind=${identityKind},canonical_validation_id=${canonicalId},validated_at=${c ? tx`clock_timestamp()` : tx`NULL`} WHERE id=${current.id} RETURNING *`;
      if (!row) throw new StudioError("STUDIO_UNAVAILABLE");
      await audit(
        tx,
        actor,
        credentials,
        row,
        status === "rejected"
          ? "rejected"
          : input.outcome === "interrupted"
            ? "interrupted"
            : "evidenced",
      );
      return row;
    },
  );
}
export async function acknowledgeValidationFileStop(
  db: P2aDatabase,
  credentials: StudioWriteCredentials,
  scope: ValidationScope,
  input: AcknowledgeValidationFileStopInput,
): Promise<ValidationRow> {
  return withStudioWrite(
    db,
    credentials,
    "import:create",
    async (tx, actor) => {
      await scopeRows(tx, scope);
      const current = await validationRow(
        tx,
        scope.productId,
        scope.importId,
        input.authority.validationId,
        true,
      );
      requireCurrentPolicy(current);
      const parsed = validationFileStopProofSchema.safeParse(input.proof);
      const attempts = parseValidationAttempts(current.attempts_text);
      const attempt = attempts.find(
        (a) => a.attemptId === current.current_attempt_id,
      );
      if (
        !parsed.success ||
        !attempt ||
        current.fence !== input.authority.fence ||
        current.current_attempt_id !== input.authority.attemptId
      )
        throw new StudioError(
          "VALIDATION_STATE_CONFLICT",
          current.state_revision,
        );
      const proof = parsed.data;
      if (
        proof.validationId !== current.id ||
        proof.attemptId !== attempt.attemptId ||
        proof.fence !== attempt.fence ||
        proof.ownerPid !== attempt.ownerPid ||
        proof.ownerNonce !== attempt.ownerNonce ||
        (attempt.mediaStop !== "unconfirmed" &&
          attempt.mediaStop !== proof.mediaStopped) ||
        (attempt.kind === "archive" && proof.mediaStopped !== "not-started")
      )
        throw new StudioError("VALIDATION_STORAGE_CONFLICT");
      if (attempt.fileStopProof) {
        if (canonicalP1Json(attempt.fileStopProof) !== canonicalP1Json(proof))
          throw new StudioError("VALIDATION_STORAGE_CONFLICT");
        return current;
      }
      await authorityRow(tx, scope, input.authority);
      if (attempt.disposition !== "held" || attempt.fileStopProof !== null)
        throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
      const controls = serializeValidationAttempts(
        attempts.map((a) =>
          a.attemptId === attempt.attemptId
            ? { ...a, mediaStop: proof.mediaStopped, fileStopProof: proof }
            : a,
        ),
      );
      const [row] = await tx<
        ValidationRow[]
      >`UPDATE qf.quizpack_validation SET attempts_text=${controls},state_revision=state_revision+1,updated_at=clock_timestamp() WHERE id=${current.id} RETURNING *`;
      if (!row) throw new StudioError("STUDIO_UNAVAILABLE");
      await audit(tx, actor, credentials, row, "file_stop_acknowledged");
      return row;
    },
  );
}
export async function beginArchiving(
  db: P2aDatabase,
  credentials: StudioWriteCredentials,
  scope: ValidationScope,
  authority: ValidationAuthority,
) {
  return withStudioWrite(
    db,
    credentials,
    "import:create",
    async (tx, actor) => {
      const current = await authorityRow(tx, scope, authority);
      requireCurrentPolicy(current);
      if (current.status !== "validated")
        throw new StudioError(
          "VALIDATION_STATE_CONFLICT",
          current.state_revision,
        );
      const [row] = await tx<
        ValidationRow[]
      >`UPDATE qf.quizpack_validation SET status='archiving',state_revision=state_revision+1,updated_at=clock_timestamp() WHERE id=${current.id} RETURNING *`;
      if (!row) throw new StudioError("STUDIO_UNAVAILABLE");
      await audit(tx, actor, credentials, row, "evidenced");
      return row;
    },
  );
}
export async function completeValidation(
  db: P2aDatabase,
  credentials: StudioWriteCredentials,
  scope: ValidationScope,
  input: CompleteValidationInput,
) {
  return withStudioWrite(
    db,
    credentials,
    "import:create",
    async (tx, actor) => {
      const current = await authorityRow(tx, scope, input.authority);
      requireAcknowledgedAttempts(current);
      if (
        current.status !== "archiving" ||
        current.canonical_content_text === null
      )
        throw new StudioError(
          "VALIDATION_STATE_CONFLICT",
          current.state_revision,
        );
      const resources = (
        JSON.parse(current.canonical_content_text) as {
          resources: {
            id: string;
            version: string;
            productId: string;
            sha256: string;
            bytes: number;
            mediaType: string;
            width: number;
            height: number;
            purpose: string;
          }[];
        }
      ).resources;
      const plan = (
        JSON.parse(current.asset_set_text!) as {
          resources: {
            resourceId: string;
            resourceVersion: string;
            blobSha256: string;
            declarationSha256: string;
          }[];
        }
      ).resources;
      const expectedHashes = [...new Set(plan.map((r) => r.blobSha256))].sort();
      const blobs = [...input.blobs].sort((a, b) =>
        a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0,
      );
      if (
        blobs.length !== expectedHashes.length ||
        blobs.some((b, i) => b.sha256 !== expectedHashes[i])
      )
        throw new StudioError("EVIDENCE_INVALID");
      for (const r of resources) {
        const item = plan.find(
          (p) => p.resourceId === r.id && p.resourceVersion === r.version,
        );
        if (!item) throw new StudioError("EVIDENCE_INVALID");
        const [stored] = await tx<
          {
            blob_sha256: string;
            declaration_sha256: string;
            declaration_text: string;
          }[]
        >`SELECT blob_sha256,declaration_sha256,declaration_text FROM qf.product_asset WHERE product_id=${scope.productId} AND resource_id=${r.id} AND resource_version=${r.version}`;
        if (
          stored &&
          (stored.blob_sha256 !== item.blobSha256 ||
            stored.declaration_sha256 !== item.declarationSha256 ||
            stored.declaration_text !== canonicalP1Json(r))
        ) {
          const attempts = parseValidationAttempts(current.attempts_text);
          if (attempts.some((a) => a.mediaStop === "unconfirmed"))
            throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
          const [rejected] = await tx<
            ValidationRow[]
          >`UPDATE qf.quizpack_validation SET status='rejected',state_revision=state_revision+1,updated_at=clock_timestamp(),lease_until=NULL,attempts_text=${serializeValidationAttempts(attempts.map((a) => ({ ...a, disposition: "released" })))},reserved_bytes=0,accounted_bytes=${input.accountedBytes},storage_condition='clean',last_error_code='RESOURCE_DECLARATION_CONFLICT' WHERE id=${current.id} RETURNING *`;
          if (!rejected) throw new StudioError("STUDIO_UNAVAILABLE");
          await audit(tx, actor, credentials, rejected, "rejected");
          return rejected;
        }
      }
      for (const b of blobs) {
        await tx`INSERT INTO qf.asset_blob(sha256,bytes,media_type,width,height,frames,storage_key,created_at) VALUES(${b.sha256},${b.bytes},${b.mediaType},${b.width},${b.height},${b.frames},${`blobs/${b.sha256}.blob`},clock_timestamp()) ON CONFLICT(sha256) DO NOTHING`;
        const [stored] = await tx<
          {
            bytes: number;
            media_type: string;
            width: number;
            height: number;
            frames: number;
            storage_key: string;
          }[]
        >`SELECT bytes,media_type,width,height,frames,storage_key FROM qf.asset_blob WHERE sha256=${b.sha256}`;
        if (
          !stored ||
          stored.bytes !== b.bytes ||
          stored.media_type !== b.mediaType ||
          stored.width !== b.width ||
          stored.height !== b.height ||
          stored.frames !== 1 ||
          stored.storage_key !== `blobs/${b.sha256}.blob`
        )
          throw new StudioError("VALIDATION_STORAGE_CONFLICT");
      }
      for (const r of [...resources].sort((a, b) =>
        a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : a.version < b.version
              ? -1
              : a.version > b.version
                ? 1
                : 0,
      )) {
        const item = plan.find(
          (p) => p.resourceId === r.id && p.resourceVersion === r.version,
        )!;
        const text = canonicalP1Json(r);
        await tx`INSERT INTO qf.product_asset(product_id,resource_id,resource_version,blob_sha256,declaration_text,declaration_sha256,purpose,source_validation_id,platform_approval,created_at) VALUES(${scope.productId},${r.id},${r.version},${item.blobSha256},${text},${item.declarationSha256},${r.purpose},${current.id},'unverified',clock_timestamp()) ON CONFLICT(product_id,resource_id,resource_version) DO NOTHING`;
        const [stored] = await tx<
          {
            blob_sha256: string;
            declaration_sha256: string;
            declaration_text: string;
            purpose: string;
          }[]
        >`SELECT blob_sha256,declaration_sha256,declaration_text,purpose FROM qf.product_asset WHERE product_id=${scope.productId} AND resource_id=${r.id} AND resource_version=${r.version}`;
        if (
          !stored ||
          stored.blob_sha256 !== item.blobSha256 ||
          stored.declaration_sha256 !== item.declarationSha256 ||
          stored.declaration_text !== text ||
          stored.purpose !== r.purpose
        )
          throw new StudioError("VALIDATION_STORAGE_CONFLICT");
      }
      const attempts = parseValidationAttempts(current.attempts_text);
      if (attempts.some((a) => a.mediaStop === "unconfirmed"))
        throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
      const controls = serializeValidationAttempts(
        attempts.map((a) => ({ ...a, disposition: "released" })),
      );
      const [row] = await tx<
        ValidationRow[]
      >`UPDATE qf.quizpack_validation SET status='ready',state_revision=state_revision+1,updated_at=clock_timestamp(),ready_at=clock_timestamp(),lease_until=NULL,attempts_text=${controls},reserved_bytes=0,accounted_bytes=${input.accountedBytes},storage_condition='clean',last_error_code=NULL WHERE id=${current.id} RETURNING *`;
      if (!row) throw new StudioError("STUDIO_UNAVAILABLE");
      await audit(tx, actor, credentials, row, "completed");
      return row;
    },
  );
}
async function reconcile(
  db: P2aDatabase,
  credentials: StudioWriteCredentials,
  scope: ValidationScope,
  input: ReconcileValidationInput,
  recover: boolean,
) {
  return withStudioWrite(
    db,
    credentials,
    "import:create",
    async (tx, actor) => {
      await scopeRows(tx, scope, false);
      const current = await validationRow(
        tx,
        scope.productId,
        scope.importId,
        input.authority.validationId,
        true,
      );
      // Exact durable completion replay has no state change or audit, even after a lost response.
      if (current.status === "ready") return current;
      requireCurrentPolicy(current);
      if (!recover) await authorityRow(tx, scope, input.authority);
      if (
        current.state_revision !== input.authority.expectedStateRevision ||
        current.fence !== input.authority.fence ||
        current.current_attempt_id !== input.authority.attemptId
      )
        throw new StudioError(
          "VALIDATION_STATE_CONFLICT",
          current.state_revision,
        );
      increment(current, recover);
      const attempts = parseValidationAttempts(current.attempts_text);
      if (
        new Set(input.settledAttempts.map((p) => p.attemptId)).size !==
          input.settledAttempts.length ||
        input.settledAttempts.some(
          (p) => !attempts.some((a) => a.attemptId === p.attemptId),
        )
      )
        throw new StudioError("VALIDATION_STORAGE_CONFLICT");
      const updated = attempts.map((a) => {
        const proof = input.settledAttempts.find(
          (p) => p.attemptId === a.attemptId,
        );
        if (!proof) return a;
        if (
          !a.fileStopProof ||
          canonicalP1Json(a.fileStopProof) !==
            canonicalP1Json(proof.fileStopProof) ||
          a.fileStopProof.mediaStopped !== proof.mediaStop
        )
          throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
        if (a.mediaStop !== "unconfirmed" && a.mediaStop !== proof.mediaStop)
          throw new StudioError("VALIDATION_STORAGE_CONFLICT");
        return {
          ...a,
          mediaStop: proof.mediaStop,
          disposition: "released" as const,
        };
      });
      const reserved =
        updated.filter((a) => a.disposition === "held").length *
        VALIDATION_RESERVATION_BYTES;
      const clean = reserved === 0 && input.storageCondition === "clean";
      const status =
        current.status === "rejected"
          ? "rejected"
          : current.validated_at !== null && clean
            ? "validated"
            : "retryable-failed";
      const [row] = await tx<
        ValidationRow[]
      >`UPDATE qf.quizpack_validation SET status=${status},state_revision=state_revision+1,updated_at=clock_timestamp(),fence=fence+${recover ? 1 : 0},lease_until=NULL,attempts_text=${serializeValidationAttempts(updated)},reserved_bytes=${reserved},accounted_bytes=${input.accountedBytes},storage_condition=${clean ? "clean" : input.storageCondition === "clean" ? "unknown" : input.storageCondition},last_error_code=${input.errorCode} WHERE id=${current.id} RETURNING *`;
      if (!row) throw new StudioError("STUDIO_UNAVAILABLE");
      await audit(
        tx,
        actor,
        credentials,
        row,
        recover ? "recovered" : "interrupted",
      );
      return row;
    },
  );
}
export const interruptValidation = (
  db: P2aDatabase,
  credentials: StudioWriteCredentials,
  scope: ValidationScope,
  input: ReconcileValidationInput,
) => reconcile(db, credentials, scope, input, false);
export const recoverValidationClaim = (
  db: P2aDatabase,
  credentials: StudioWriteCredentials,
  scope: ValidationScope,
  input: ReconcileValidationInput,
) => reconcile(db, credentials, scope, input, true);
export async function retryValidationClaim(
  db: P2aDatabase,
  credentials: StudioWriteCredentials,
  scope: ValidationScope,
  validationId: string,
  input: RetryValidationInput,
) {
  return withStudioWrite(
    db,
    credentials,
    "import:create",
    async (tx, actor) => {
      await scopeRows(tx, scope);
      const current = await validationRow(
        tx,
        scope.productId,
        scope.importId,
        validationId,
        true,
      );
      if (current.state_revision !== input.expectedStateRevision)
        throw new StudioError(
          "VALIDATION_STATE_CONFLICT",
          current.state_revision,
        );
      increment(current, true);
      const attempts = parseValidationAttempts(current.attempts_text);
      if (
        current.status === "ready" ||
        current.status === "rejected" ||
        current.storage_condition !== "clean" ||
        Number(current.reserved_bytes) !== 0 ||
        attempts.some(
          (a) => a.disposition !== "released" || a.mediaStop === "unconfirmed",
        )
      )
        throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
      if (attempts.length >= MAX_ATTEMPTS)
        throw new StudioError("VALIDATION_ATTEMPT_LIMIT");
      if (
        input.binding.identityText !== current.identity_text ||
        input.binding.identitySha256 !== current.identity_sha256 ||
        input.binding.validationKey !== current.validation_key ||
        input.binding.archivePolicyVersion !== current.archive_policy_version ||
        input.binding.archivePolicySha256 !== current.archive_policy_sha256
      )
        throw new StudioError("VALIDATION_REVALIDATION_REQUIRED");
      const attempt = nextAttempt(
        current,
        input.owner,
        current.validated_at === null ? "validate" : "archive",
      );
      const controls = serializeValidationAttempts([...attempts, attempt]);
      const [row] = await tx<
        ValidationRow[]
      >`UPDATE qf.quizpack_validation SET status=${attempt.kind === "validate" ? "validating" : "archiving"},state_revision=state_revision+1,updated_at=clock_timestamp(),fence=fence+1,lease_until=clock_timestamp()+interval '120 seconds',current_attempt_id=${attempt.attemptId},attempts_text=${controls},reserved_bytes=${VALIDATION_RESERVATION_BYTES},storage_condition='unknown',last_error_code=NULL WHERE id=${current.id} RETURNING *`;
      if (!row) throw new StudioError("STUDIO_UNAVAILABLE");
      await audit(tx, actor, credentials, row, "retried");
      return row;
    },
  );
}
export const validationTransactions: ValidationTransactions = {
  acknowledgeValidationFileStop,
  claimValidation,
  appendValidationEvidence,
  beginArchiving,
  completeValidation,
  interruptValidation,
  recoverValidationClaim,
  retryValidationClaim,
};
