import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import { StudioError } from "@/lib/http-security/errors";
import { productIdSchema } from "@/features/product/workspace/contracts";
import { productRow } from "@/features/product/workspace/repository";
import { importIdSchema } from "../import/contracts";
import { importRow, parse, read, type ImportRow } from "../import/repository";
import { currentConfig } from "../import/service";
import { StorageLock } from "../import/storage-lock";
import {
  assertNoConfigGuard,
  scanStorage,
  scannedFiles,
  removeOwned,
} from "../import/storage";
import {
  measuredStorageQuota,
  requireQuota,
  requireStorageCapacity,
} from "../import/quota";
import { canonicalP1Json } from "../v1/canonical";
import {
  prepareValidationIdentity,
  restoreValidatedCandidate,
  validateArchiveCandidate,
  candidateResultEvidenceSchema,
  sealEvidenceEnvelope,
  serializeEvidenceSqlProjection,
  type CandidateResult,
  type PreparedIdentityResult,
  type PrivateArchiveCandidate,
  type RestoreCandidateInput,
  type ValidationIdentity,
} from "../server/validation";
import {
  prepareValidationSchema,
  startValidationSchema,
  validationCasSchema,
  validationIdSchema,
  validationListQuerySchema,
  preclaimStartCodeSchema,
  validationErrorCodeSchema,
  type StartValidationResult,
} from "./contracts";
import { ArchiveOperation } from "./operation";
import {
  assetSetLedgerSchema,
  exactValidation,
  requireCurrentValidation,
  validationRow,
  validationPolicyRow,
  validationRowDto,
  validationDto,
  archivedResourceCount,
  validationKey,
  parseValidationAttempts,
  serializeValidationAttempts,
  type ValidationRow,
  type ValidationBinding,
} from "./repository";
import { validationTransactions as transactions } from "./transactions";
import { ARCHIVE_POLICY_VERSION, archivePolicySha256 } from "./policy";
import { MAX_METADATA_BYTES, VALIDATION_RESERVATION_BYTES } from "./limits";
import { createArchiveStorage } from "./storage";
import { readHeldStorageRows } from "./storage-ledger";
import {
  writeValidationStopped,
  validationFileStopPublication,
} from "./receipt";
import { recoverValidationFiles } from "./recovery";
import type { QuizpackValidationService } from "./service-contract";
import type {
  BlobFact,
  ValidationAuthority,
  ValidationScope,
} from "./transactions-contract";

const storage = createArchiveStorage();
function received(row: ImportRow) {
  if (
    row.status !== "received" ||
    row.actual_archive_sha256 === null ||
    row.actual_archive_bytes === null
  )
    throw new StudioError("IMPORT_STATE_CONFLICT", row.state_revision);
  return {
    archiveSha256: row.actual_archive_sha256,
    archiveBytes: row.actual_archive_bytes,
  };
}
function binding(
  scope: ValidationScope,
  original: ImportRow,
  identity: ValidationIdentity,
): ValidationBinding {
  const identityRow = {
    archive_policy_version: ARCHIVE_POLICY_VERSION,
    archive_policy_sha256: archivePolicySha256,
    identity_text: canonicalP1Json(identity),
    identity_sha256: identity.identitySha256,
  };
  requireCurrentValidation(identityRow);
  const input = {
    ...scope,
    ...received(original),
    identitySha256: identity.identitySha256,
    archivePolicyVersion: ARCHIVE_POLICY_VERSION,
    archivePolicySha256,
  };
  return {
    identityText: canonicalP1Json(identity),
    identitySha256: identity.identitySha256,
    archivePolicyVersion: ARCHIVE_POLICY_VERSION,
    archivePolicySha256,
    validationKey: validationKey(input),
  };
}
function authority(row: ValidationRow): ValidationAuthority {
  return {
    validationId: row.id,
    expectedStateRevision: row.state_revision,
    fence: row.fence,
    attemptId: row.current_attempt_id,
  };
}
function attempt(row: ValidationRow) {
  const current = parseValidationAttempts(row.attempts_text).find(
    (a) => a.attemptId === row.current_attempt_id,
  );
  if (!current) throw new StudioError("VALIDATION_STORAGE_CONFLICT");
  return current;
}
function prepared(
  op: ArchiveOperation,
  result: PreparedIdentityResult,
): Extract<PreparedIdentityResult, { outcome: "prepared" }> {
  op.recordPlatformCompletion(result.completion);
  if (result.outcome !== "prepared") throw new StudioError("MEDIA_UNAVAILABLE");
  op.checkpoint();
  return result;
}
async function preflight(
  op: ArchiveOperation,
  c: StudioWriteCredentials,
  scope: ValidationScope,
  validationId?: string,
) {
  return op.databaseAwait("read", () =>
    read(
      op.db,
      c.sessionToken,
      async (tx) => {
        const product = await productRow(tx, scope.productId),
          original = await importRow(tx, scope.productId, scope.importId);
        received(original);
        if (validationId !== undefined)
          requireCurrentValidation(
            await validationPolicyRow(
              tx,
              scope.productId,
              scope.importId,
              validationId,
            ),
          );
        return { product, original };
      },
      c,
    ),
  );
}
async function acquire(op: ArchiveOperation) {
  const lock = await op.fileTask(() =>
    StorageLock.acquire(op.db.config, op.context),
  );
  op.attachLock(lock);
  const config = await op.fileTask(async () => {
    const value = await currentConfig(op.db);
    op.nonDbCheckpoint();
    await assertNoConfigGuard(value);
    op.nonDbCheckpoint();
    if (!value.imports.enabled) throw new StudioError("IMPORTS_DISABLED");
    return value;
  });
  return { lock, config };
}
function finite(error: unknown): never {
  if (error instanceof StudioError) {
    if (error.code === "RECEIVE_STORAGE_CONFLICT")
      throw new StudioError("VALIDATION_STORAGE_CONFLICT");
    if (error.code === "RECEIVE_SCAN_LIMIT")
      throw new StudioError("VALIDATION_SCAN_LIMIT");
    if (error.code === "RECEIVE_QUOTA_EXCEEDED")
      throw new StudioError("VALIDATION_QUOTA_EXCEEDED");
    if (error.code === "RECEIVE_BUSY") throw new StudioError("VALIDATION_BUSY");
    if (error.code === "RECEIVE_LOCK_LOST")
      throw new StudioError("VALIDATION_LOCK_LOST");
    if (error.code === "RECEIVE_TIMEOUT")
      throw new StudioError("VALIDATION_TIMEOUT");
    throw error;
  }
  throw new StudioError("STUDIO_UNAVAILABLE");
}
function restoreInput(
  row: ValidationRow,
  handle: Extract<PreparedIdentityResult, { outcome: "prepared" }>["prepared"],
): RestoreCandidateInput {
  if (
    row.evidence_text === null ||
    row.evidence_sha256 === null ||
    row.evidence_metadata_text === null ||
    row.pack_id === null ||
    row.pack_version === null ||
    row.container_schema_version !== "quizpack.v1" ||
    (row.content_schema_version !== "quizpack-content.v1" &&
      row.content_schema_version !== "quizpack-content.v2") ||
    (row.content_kind !== "synthetic" && row.content_kind !== "authored") ||
    row.manifest_sha256 === null ||
    row.content_sha256 === null ||
    row.canonical_manifest_text === null ||
    row.canonical_manifest_sha256 === null ||
    row.canonical_content_text === null ||
    row.canonical_content_sha256 === null ||
    row.asset_set_text === null ||
    row.asset_set_sha256 === null ||
    row.candidate_sha256 === null ||
    row.resource_count === null
  )
    throw new StudioError("EVIDENCE_INVALID");
  return {
    prepared: handle,
    frozenEvidence: {
      evidenceText: row.evidence_text,
      evidenceSha256: row.evidence_sha256,
      reportTexts: row.report_texts,
      metadataText: row.evidence_metadata_text,
      attemptsControlText: row.attempts_text,
    },
    expectedFacts: {
      archiveSha256: row.archive_sha256,
      archiveBytes: row.archive_bytes,
      productId: row.product_id,
      packId: row.pack_id,
      packVersion: row.pack_version,
      containerSchemaVersion: row.container_schema_version,
      contentSchemaVersion: row.content_schema_version,
      contentKind: row.content_kind,
      manifestSha256: row.manifest_sha256,
      contentSha256: row.content_sha256,
      canonicalManifestText: row.canonical_manifest_text,
      canonicalManifestSha256: row.canonical_manifest_sha256,
      canonicalContentText: row.canonical_content_text,
      canonicalContentSha256: row.canonical_content_sha256,
      assetSetText: row.asset_set_text,
      assetSetSha256: row.asset_set_sha256,
      candidateSha256: row.candidate_sha256,
      resourceCount: row.resource_count,
    },
  };
}
async function dto(
  op: ArchiveOperation,
  c: StudioWriteCredentials,
  row: ValidationRow,
) {
  return op.databaseAwait("read", () =>
    read(op.db, c.sessionToken, (tx) => validationRowDto(tx, row), c),
  );
}
async function frozenResourceCount(
  op: ArchiveOperation,
  c: StudioWriteCredentials,
  row: ValidationRow,
) {
  if (row.asset_set_text === null) return 0;
  return op.databaseAwait("read", () =>
    read(op.db, c.sessionToken, (tx) => archivedResourceCount(tx, row), c),
  );
}
async function finish(op: ArchiveOperation) {
  op.stop();
  try {
    await op.closeStorageLock();
  } catch {
    op.markRelatedIoUnknown();
  } finally {
    await op.settle();
  }
}
async function finalizeKnownActiveFailure(
  op: ArchiveOperation,
  c: StudioWriteCredentials,
  scope: ValidationScope,
  config: Awaited<ReturnType<typeof currentConfig>>,
  initial: ValidationRow,
  error: unknown,
) {
  op.checkpoint();
  if (
    op.hasEnteredAcknowledgement() ||
    op.hasEnteredFinalization() ||
    op.completion().maintenanceRequired
  )
    throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
  const scan = await op.fileTask(() => scanStorage(config, op.context)),
    attempts = parseValidationAttempts(initial.attempts_text),
    current = attempt(initial);
  // Before any cleanup, all entries must be from the immutable closed plan; never remove final blobs.
  const files = scannedFiles(scan, "validation", initial.id);
  for (const f of files) {
    const name = path.basename(f.file);
    if (name === `attempt-${current.attemptId}.partial`) continue;
    if (
      !attempts.some(
        (a) =>
          a.fileStopProof &&
          a.attemptId !== current.attemptId &&
          name === `stopped-${a.attemptId}.json`,
      )
    )
      throw new StudioError("VALIDATION_STORAGE_CONFLICT");
  }
  for (const f of files.filter(
    (f) => path.basename(f.file) === `attempt-${current.attemptId}.partial`,
  ))
    await op.fileTask(async () => {
      await removeOwned(f.file, f.inode);
      op.nonDbCheckpoint();
    });
  const fresh = await op.fileTask(() => scanStorage(config, op.context)),
    before = scannedFiles(fresh, "validation", initial.id);
  const archivedCount = await frozenResourceCount(op, c, initial);
  op.closeNonDbGate();
  await op.settle();
  if (!(await writeValidationStopped(op, config, initial.id, current)))
    throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
  const publication = validationFileStopPublication(op, initial.id, current),
    parsed = validationErrorCodeSchema.safeParse(
      error instanceof StudioError ? error.code : "STUDIO_UNAVAILABLE",
    ),
    code = parsed.success ? parsed.data : "STUDIO_UNAVAILABLE";
  let row = await op.acknowledgeDatabaseOnce(publication.qualification, () =>
    transactions.acknowledgeValidationFileStop(op.db, c, scope, {
      authority: authority(initial),
      proof: publication.proof,
    }),
  );
  row = await op.finalizeDatabaseOnce(() =>
    transactions.interruptValidation(op.db, c, scope, {
      authority: authority(row),
      settledAttempts: [
        {
          attemptId: current.attemptId,
          mediaStop: publication.proof.mediaStopped,
          fileStopProof: publication.proof,
        },
      ],
      accountedBytes:
        before.reduce((sum, f) => sum + f.size, 0) + publication.bytes,
      storageCondition: "clean",
      errorCode: code,
    }),
  );
  return validationDto(row, archivedCount);
}
async function execute(
  op: ArchiveOperation,
  c: StudioWriteCredentials,
  scope: ValidationScope,
  config: Awaited<ReturnType<typeof currentConfig>>,
  initial: ValidationRow,
  archivePrepared?: Extract<PreparedIdentityResult, { outcome: "prepared" }>,
) {
  let row = initial,
    archivedCount = 0,
    candidate: PrivateArchiveCandidate | null = null;
  const currentAttempt = attempt(row);
  try {
    const raw = await storage.readArchive(
      op,
      config,
      scope.importId,
      row.archive_bytes,
      row.archive_sha256,
    );
    op.enterCandidateBoundary();
    if (currentAttempt.kind === "archive") {
      if (!archivePrepared) throw new StudioError("EVIDENCE_INVALID");
      const restored = await op.platformTask(() =>
        restoreValidatedCandidate(
          raw,
          restoreInput(row, archivePrepared.prepared),
          op.context,
        ),
      );
      op.recordPlatformCompletion(restored.completion);
      if (restored.outcome !== "restored")
        throw new StudioError(
          restored.outcome === "unavailable" &&
            restored.code === "REVALIDATION_REQUIRED"
            ? "VALIDATION_REVALIDATION_REQUIRED"
            : "EVIDENCE_INVALID",
        );
      candidate = restored.candidate;
    } else {
      const result: CandidateResult = await op.platformTask(() =>
        validateArchiveCandidate(raw, scope.productId, op.context),
      );
      op.recordPlatformCompletion(result.evidence.completion);
      op.checkpoint();
      if (
        result.evidence.identity.status === "bound" &&
        result.evidence.identity.value.identitySha256 !== row.identity_sha256
      )
        throw new StudioError("VALIDATION_IDENTITY_CHANGED");
      const evidence = candidateResultEvidenceSchema.parse(
          result.outcome === "accepted"
            ? { outcome: result.outcome, evidence: result.evidence }
            : result,
        ),
        prior =
          row.evidence_text === null
            ? []
            : sealEvidenceEnvelope(JSON.parse(row.evidence_text)).attempts;
      const envelope = sealEvidenceEnvelope({
        schemaVersion: "quizpack-evidence-envelope.v1",
        attempts: [
          ...prior,
          { attempt: currentAttempt.ordinal, result: evidence },
        ],
      });
      const mediaStop =
        result.evidence.completion.mediaStopped === "unknown"
          ? "unconfirmed"
          : result.evidence.completion.mediaStopped;
      const controls = serializeValidationAttempts(
        parseValidationAttempts(row.attempts_text).map((a) =>
          a.attemptId === currentAttempt.attemptId ? { ...a, mediaStop } : a,
        ),
      );
      const projection = serializeEvidenceSqlProjection(envelope, controls);
      if (
        !projection.ok ||
        (projection.value.metadataText !== null &&
          Buffer.byteLength(projection.value.metadataText) > MAX_METADATA_BYTES)
      )
        throw new StudioError("EVIDENCE_INVALID");
      const report = result.evidence.report;
      const frozen =
        result.outcome === "accepted" && report.status === "sealed"
          ? {
              facts: result.candidate.facts,
              manifestSha256: report.value.manifestSha256!,
              contentSha256: report.value.contentSha256!,
            }
          : null;
      row = await op.databaseAwait("write", () =>
        transactions.appendValidationEvidence(op.db, c, scope, {
          authority: authority(row),
          projection: projection.value,
          mediaStop,
          candidate: frozen,
          outcome: result.outcome,
          errorCode:
            result.outcome === "rejected"
              ? "VALIDATION_REJECTED"
              : result.outcome === "interrupted"
                ? "MEDIA_UNAVAILABLE"
                : null,
        }),
      );
      if (result.outcome === "accepted" && row.status !== "rejected")
        candidate = result.candidate;
    }
    if (candidate) {
      if (row.status === "validated")
        row = await op.databaseAwait("write", () =>
          transactions.beginArchiving(op.db, c, scope, authority(row)),
        );
      const blobs = new Map<string, BlobFact>();
      for (let index = 0; index < candidate.facts.resources.length; index++) {
        const fact = await storage.archiveBlob(
          op,
          config,
          row.id,
          attempt(row),
          candidate,
          index,
        );
        const existing = blobs.get(fact.sha256);
        if (existing && canonicalP1Json(existing) !== canonicalP1Json(fact))
          throw new StudioError("VALIDATION_STORAGE_CONFLICT");
        blobs.set(fact.sha256, fact);
      }
      const scan = await op.fileTask(() => scanStorage(config, op.context)),
        before = scannedFiles(scan, "validation", row.id);
      archivedCount = await frozenResourceCount(op, c, row);
      op.closeNonDbGate();
      await op.settle();
      if (!(await writeValidationStopped(op, config, row.id, attempt(row))))
        throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
      const publication = validationFileStopPublication(
        op,
        row.id,
        attempt(row),
      );
      const accountedBytes =
        before.reduce((sum, f) => sum + f.size, 0) +
        (before.some(
          (f) =>
            path.basename(f.file) ===
            `stopped-${currentAttempt.attemptId}.json`,
        )
          ? 0
          : publication.bytes);
      row = await op.acknowledgeDatabaseOnce(publication.qualification, () =>
        transactions.acknowledgeValidationFileStop(op.db, c, scope, {
          authority: authority(row),
          proof: publication.proof,
        }),
      );
      row = await op.finalizeDatabaseOnce(() =>
        transactions.completeValidation(op.db, c, scope, {
          authority: authority(row),
          blobs: [...blobs.values()],
          accountedBytes,
        }),
      );
    } else {
      const scan = await op.fileTask(() => scanStorage(config, op.context)),
        before = scannedFiles(scan, "validation", row.id);
      archivedCount = await frozenResourceCount(op, c, row);
      op.closeNonDbGate();
      await op.settle();
      if (!(await writeValidationStopped(op, config, row.id, attempt(row))))
        throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
      const publication = validationFileStopPublication(
        op,
        row.id,
        attempt(row),
      );
      const accountedBytes =
        before.reduce((sum, f) => sum + f.size, 0) +
        (before.some(
          (f) =>
            path.basename(f.file) ===
            `stopped-${currentAttempt.attemptId}.json`,
        )
          ? 0
          : publication.bytes);
      row = await op.acknowledgeDatabaseOnce(publication.qualification, () =>
        transactions.acknowledgeValidationFileStop(op.db, c, scope, {
          authority: authority(row),
          proof: publication.proof,
        }),
      );
      row = await op.finalizeDatabaseOnce(() =>
        transactions.interruptValidation(op.db, c, scope, {
          authority: authority(row),
          settledAttempts: [
            {
              attemptId: currentAttempt.attemptId,
              mediaStop: publication.proof.mediaStopped,
              fileStopProof: publication.proof,
            },
          ],
          accountedBytes,
          storageCondition: "clean",
          errorCode: row.last_error_code,
        }),
      );
    }
    return validationDto(
      row,
      row.status === "ready" ? row.resource_count! : archivedCount,
    );
  } catch (error) {
    // Known active failures may close their files and acknowledge them; stopped or UNKNOWN requests never revive.
    if (!op.hasEnteredAcknowledgement() && !op.hasEnteredFinalization()) {
      await op.settle();
      try {
        return await finalizeKnownActiveFailure(
          op,
          c,
          scope,
          config,
          row,
          error,
        );
      } catch (failure) {
        if (op.hasEnteredAcknowledgement() || op.hasEnteredFinalization())
          error = failure;
        // Before ACK, lack of proof preserves the original failure and held reservation.
      }
    }
    op.stop();
    await op.settle();
    // Once finalization may have started, the receipt gate is consumed and no more files/transactions are issued.
    if (!op.hasEnteredAcknowledgement() && !op.hasEnteredFinalization()) {
      try {
        await writeValidationStopped(op, config, row.id, attempt(row));
      } catch {
        /* held reservation and immutable facts remain for fresh recovery */
      }
    }
    return finite(error);
  }
}

/** Ordinary fixed service. No HTTP/config field can supply IO, runtime or transaction dependencies. */
export function createQuizpackValidationService(): QuizpackValidationService {
  return {
    async prepareValidation(db, c, productId, importId, input, context) {
      const scope = {
          productId: parse(productIdSchema, productId),
          importId: parse(importIdSchema, importId),
        },
        value = parse(prepareValidationSchema, input),
        op = new ArchiveOperation(db, context);
      try {
        await preflight(op, c, scope);
        await acquire(op);
        const { product, original } = await preflight(op, c, scope);
        if (product.archived_at !== null)
          throw new StudioError("PRODUCT_ARCHIVED");
        if (original.state_revision !== value.expectedImportStateRevision)
          throw new StudioError(
            "IMPORT_STATE_CONFLICT",
            original.state_revision,
          );
        const identity = prepared(
            op,
            await op.platformTask(() => prepareValidationIdentity(context)),
          ).identity,
          bound = binding(scope, original, identity);
        return {
          ...scope,
          expectedImportStateRevision: value.expectedImportStateRevision,
          ...received(original),
          identitySha256: identity.identitySha256,
          validationKey: bound.validationKey,
        };
      } catch (error) {
        return finite(error);
      } finally {
        await finish(op);
      }
    },
    async startValidation(
      db,
      c,
      productId,
      importId,
      input,
      context,
    ): Promise<StartValidationResult> {
      const scope = {
          productId: parse(productIdSchema, productId),
          importId: parse(importIdSchema, importId),
        },
        value = parse(startValidationSchema, input),
        op = new ArchiveOperation(db, context);
      try {
        await preflight(op, c, scope);
        const { lock, config } = await acquire(op);
        const existing = await op.databaseAwait("read", () =>
          read(
            db,
            c.sessionToken,
            async (tx) => {
              const original = await importRow(
                tx,
                scope.productId,
                scope.importId,
              );
              received(original);
              return exactValidation(
                tx,
                scope.productId,
                scope.importId,
                value.expectedValidationKey,
              );
            },
            c,
          ),
        );
        if (existing)
          return {
            outcome: "record",
            created: false,
            validation: await dto(op, c, existing),
          };
        const { product, original } = await preflight(op, c, scope);
        if (product.archived_at !== null)
          throw new StudioError("PRODUCT_ARCHIVED");
        if (original.state_revision !== value.expectedImportStateRevision)
          throw new StudioError(
            "IMPORT_STATE_CONFLICT",
            original.state_revision,
          );
        const scan = await op.fileTask(() => scanStorage(config, context)),
          rows = await op.fileTask(() =>
            readHeldStorageRows(lock, "validation"),
          );
        const identity = prepared(
            op,
            await op.platformTask(() => prepareValidationIdentity(context)),
          ).identity,
          bound = binding(scope, original, identity);
        if (bound.validationKey !== value.expectedValidationKey)
          throw new StudioError("VALIDATION_IDENTITY_CHANGED");
        requireStorageCapacity(scan, rows, {
          namespace: "validation",
          id: randomUUID(),
          assetBlobHashes: null,
        });
        requireQuota(
          measuredStorageQuota(scan, rows),
          VALIDATION_RESERVATION_BYTES,
        );
        op.enterClaimBoundary();
        const claimed = await op.databaseAwait("write", () =>
          transactions.claimValidation(db, c, scope, {
            ...value,
            binding: bound,
            owner: {
              ownerPid: process.pid,
              ownerNonce: randomBytes(32).toString("base64url"),
            },
          }),
        );
        if (!claimed.created)
          return {
            outcome: "record",
            created: false,
            validation: await dto(op, c, claimed.row),
          };
        op.confirmClaim();
        return {
          outcome: "record",
          created: true,
          validation: await execute(op, c, scope, config, claimed.row),
        };
      } catch (error) {
        let translated: StudioError;
        try {
          finite(error);
        } catch (e) {
          translated = e as StudioError;
        }
        op.stop();
        await op.settle();
        await op.closeStorageLock();
        await op.settle();
        const code = preclaimStartCodeSchema.safeParse(translated!.code);
        if (code.success && op.canIssuePreclaimNotStarted())
          return {
            outcome: "not-started",
            execution: "not-started",
            ...scope,
            expectedValidationKey: value.expectedValidationKey,
            expectedImportStateRevision: value.expectedImportStateRevision,
            code: code.data,
          };
        throw translated!;
      } finally {
        await finish(op);
      }
    },
    async readValidation(db, token, productId, importId, validationId) {
      const p = parse(productIdSchema, productId),
        i = parse(importIdSchema, importId),
        id = parse(validationIdSchema, validationId);
      return read(db, token, async (tx) => {
        await productRow(tx, p);
        await importRow(tx, p, i);
        return validationRowDto(tx, await validationRow(tx, p, i, id));
      });
    },
    async listValidations(db, token, productId, importId, input) {
      const p = parse(productIdSchema, productId),
        i = parse(importIdSchema, importId),
        query = parse(validationListQuerySchema, input);
      const { validationsPage } = await import("./repository");
      return read(db, token, async (tx) => {
        await productRow(tx, p);
        await importRow(tx, p, i);
        return validationsPage(tx, p, i, query);
      });
    },
    async recoverValidation(
      db,
      c,
      productId,
      importId,
      validationId,
      input,
      context,
    ) {
      const scope = {
          productId: parse(productIdSchema, productId),
          importId: parse(importIdSchema, importId),
        },
        id = parse(validationIdSchema, validationId),
        value = parse(validationCasSchema, input),
        op = new ArchiveOperation(db, context);
      try {
        await preflight(op, c, scope, id);
        const { lock, config } = await acquire(op);
        const row = await op.databaseAwait("read", () =>
          read(
            db,
            c.sessionToken,
            (tx) => validationRow(tx, scope.productId, scope.importId, id),
            c,
          ),
        );
        requireCurrentValidation(row);
        if (row.status === "ready") return await dto(op, c, row);
        if (row.state_revision !== value.expectedStateRevision)
          throw new StudioError(
            "VALIDATION_STATE_CONFLICT",
            row.state_revision,
          );
        const scan = await op.fileTask(() => scanStorage(config, context)),
          rows = await op.fileTask(() =>
            readHeldStorageRows(lock, "validation"),
          );
        measuredStorageQuota(scan, rows);
        const facts = await recoverValidationFiles(op, config, row, scan);
        const reconciled = await op.databaseAwait("write", () =>
          transactions.recoverValidationClaim(db, c, scope, {
            authority: authority(row),
            ...facts,
            errorCode: row.last_error_code,
          }),
        );
        return await dto(op, c, reconciled);
      } catch (error) {
        return finite(error);
      } finally {
        await finish(op);
      }
    },
    async retryValidation(
      db,
      c,
      productId,
      importId,
      validationId,
      input,
      context,
    ) {
      const scope = {
          productId: parse(productIdSchema, productId),
          importId: parse(importIdSchema, importId),
        },
        id = parse(validationIdSchema, validationId),
        value = parse(validationCasSchema, input),
        op = new ArchiveOperation(db, context);
      try {
        await preflight(op, c, scope, id);
        const { lock, config } = await acquire(op);
        const { product, original } = await preflight(op, c, scope);
        if (product.archived_at !== null)
          throw new StudioError("PRODUCT_ARCHIVED");
        const row = await op.databaseAwait("read", () =>
          read(
            db,
            c.sessionToken,
            (tx) => validationRow(tx, scope.productId, scope.importId, id),
            c,
          ),
        );
        requireCurrentValidation(row);
        if (row.state_revision !== value.expectedStateRevision)
          throw new StudioError(
            "VALIDATION_STATE_CONFLICT",
            row.state_revision,
          );
        if (
          row.status === "ready" ||
          row.status === "rejected" ||
          row.storage_condition !== "clean" ||
          Number(row.reserved_bytes) !== 0 ||
          parseValidationAttempts(row.attempts_text).some(
            (a) =>
              a.disposition !== "released" ||
              a.mediaStop === "unconfirmed" ||
              !a.fileStopProof,
          )
        )
          throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
        if (parseValidationAttempts(row.attempts_text).length >= 3)
          throw new StudioError("VALIDATION_ATTEMPT_LIMIT");
        const scan = await op.fileTask(() => scanStorage(config, context)),
          rows = await op.fileTask(() =>
            readHeldStorageRows(lock, "validation"),
          );
        const preparation = prepared(
            op,
            await op.platformTask(() => prepareValidationIdentity(context)),
          ),
          bound = binding(scope, original, preparation.identity);
        if (
          bound.identityText !== row.identity_text ||
          bound.validationKey !== row.validation_key ||
          bound.archivePolicySha256 !== row.archive_policy_sha256
        )
          throw new StudioError("VALIDATION_REVALIDATION_REQUIRED");
        requireStorageCapacity(scan, rows, {
          namespace: "validation",
          id,
          assetBlobHashes:
            row.asset_set_text === null
              ? null
              : assetSetLedgerSchema
                  .parse(JSON.parse(row.asset_set_text))
                  .resources.map((r) => r.blobSha256),
        });
        requireQuota(
          measuredStorageQuota(scan, rows),
          VALIDATION_RESERVATION_BYTES,
        );
        op.enterClaimBoundary();
        const claimed = await op.databaseAwait("write", () =>
          transactions.retryValidationClaim(db, c, scope, id, {
            ...value,
            binding: bound,
            owner: {
              ownerPid: process.pid,
              ownerNonce: randomBytes(32).toString("base64url"),
            },
          }),
        );
        op.confirmClaim();
        return await execute(
          op,
          c,
          scope,
          config,
          claimed,
          row.validated_at !== null ? preparation : undefined,
        );
      } catch (error) {
        return finite(error);
      } finally {
        await finish(op);
      }
    },
  };
}
