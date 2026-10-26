import { constants } from "node:fs";
import { open, lstat, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  loginVersionFixtureAccount,
  seedVersionFixtureAccount,
} from "./version-account-fixture";
import { issueToken, digestToken } from "@/lib/security/p2a-tokens";
import { readPrivateJson } from "@/lib/db/runtime";
import { acquireAuthWriteLock } from "@/lib/db/auth-lock";
import { currentConfig } from "@/features/quizpack/import/service";
import { StorageLock } from "@/features/quizpack/import/storage-lock";
import {
  createReceiveContext,
  remainingReceiveMs,
} from "@/features/quizpack/import/context";
import {
  instanceDirectory,
  ensureStorage,
  blobPath,
  privateFile,
  scanStorage,
  scannedFiles,
  removeOwned,
  importDirectory,
  validationDirectory,
  assertNoConfigGuard,
} from "@/features/quizpack/import/storage";
import { readPrivateResource } from "@/features/quizpack/resource-read/storage";
import { readFrozenDraftSourceEvidenceReadonly } from "@/features/quizpack/draft-source-evidence";
import { createProductDraftService } from "@/features/product/drafts/service";
import {
  draftRoot,
  revisionMetadata,
  summaryDto,
  applicationByKey,
  applicationDto,
  type DraftRevisionRow,
} from "@/features/product/drafts/repository";
import type { ApplicationRow } from "@/features/product/draft-revisions/repository";
import type { ImportRow } from "@/features/quizpack/import/repository";
import type { ValidationRow } from "@/features/quizpack/validation/repository";
import type { ReadyDraftSourceEvidence } from "@/features/quizpack/draft-source-evidence";
import type postgres from "postgres";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import {
  reviewReceipt,
  versionDetail,
  type ReviewRow,
  type VersionRow,
} from "@/features/product/internal-versions/repository";
import { matchRegisteredBaseline } from "@/features/product/internal-versions/baseline-registry";
import {
  IMPLEMENTATION_DESCRIPTORS,
  implementationIdentity,
} from "@/features/product/internal-versions/implementation-catalog";
import {
  rendererIdentitySchema,
  engineIdentitySchema,
  internalCanonicalText,
  internalSnapshotText,
} from "@/features/product/internal-versions/contracts";
import {
  verifyInternalReviewReceipt,
  verifyInternalVersionDetail,
} from "@/features/product/internal-versions/integrity";
import { buildInternalSnapshot } from "@/features/product/internal-versions/snapshot";
import {
  assertOnlyOwnedInternalReferences,
  assertNoRetainedInternalReferences,
} from "@/features/product/internal-versions/retention";
import { prepareP3eSource } from "./p3e-source-fixture";
import { seedReadyP2b3Source } from "./p2b3-fixture";
import {
  openTestDatabase,
  safeTestOperation,
  type TestDatabase,
} from "./p2a-fixture";
import {
  fixtureAuditAllowed,
  type FixtureAuditTarget,
} from "./p2b2b-maintenance";
import { ownerAbsent } from "./p2b2b-fixture-contract";
import { waitForPreviewAuthBudget } from "./p3c-auth-budget";
import { inspectPreviewNativeControl } from "./p3c-native-control";
import {
  assertServerExitProof,
  type ServerExitProof,
} from "../support/p3c-server-owner";
import {
  INTERNAL_VERSION_FIXTURE_PRIVATE_NAME,
  INTERNAL_VERSION_FIXTURE_MAX_BYTES,
  internalVersionFixtureSchema,
  type InternalVersionFixture,
} from "./p3e-internal-version-fixture-contract";
export {
  INTERNAL_VERSION_FIXTURE_PRIVATE_NAME,
  internalVersionFixtureSchema,
  type InternalVersionFixture,
} from "./p3e-internal-version-fixture-contract";

const quarantined: unknown[] = [];
const fail = () => Error("INTERNAL_VERSION_FIXTURE_UNKNOWN_PRESERVED");
const fixturePath = (db: TestDatabase) =>
  path.join(
    instanceDirectory(db.config),
    INTERNAL_VERSION_FIXTURE_PRIVATE_NAME,
  );
const same = (a: unknown, b: unknown) =>
  internalCanonicalText(a) === internalCanonicalText(b);
function requireTest(db: TestDatabase) {
  if (!["test", "ci"].includes(db.config.purpose)) throw fail();
}
async function absent(file: string) {
  try {
    await lstat(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  throw fail();
}
async function save(
  db: TestDatabase,
  value: InternalVersionFixture,
  create = false,
) {
  const bytes = Buffer.from(
    JSON.stringify(internalVersionFixtureSchema.parse(value)),
  );
  if (bytes.length > INTERNAL_VERSION_FIXTURE_MAX_BYTES) throw fail();
  const file = fixturePath(db),
    before = create ? undefined : await lstat(file);
  if (before) {
    privateFile(before);
    if (before.nlink !== 1) throw fail();
  }
  const target = create ? file : `${file}.tmp-${randomUUID()}`;
  const h = await open(
    target,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const st = await h.stat();
    privateFile(st);
    if (st.nlink !== 1) throw fail();
    await h.writeFile(bytes);
    await h.sync();
  } finally {
    await h.close();
  }
  if (before) {
    const current = await lstat(file);
    privateFile(current);
    if (
      current.ino !== before.ino ||
      current.dev !== before.dev ||
      current.nlink !== 1
    )
      throw fail();
    await rename(target, file);
  }
}
export async function readInternalVersionFixture(
  db: TestDatabase,
  runId: string,
): Promise<InternalVersionFixture> {
  requireTest(db);
  z.uuid().parse(runId);
  const st = await lstat(fixturePath(db));
  privateFile(st);
  if (st.nlink !== 1 || st.size > INTERNAL_VERSION_FIXTURE_MAX_BYTES)
    throw fail();
  const value = internalVersionFixtureSchema.parse(
    await readPrivateJson(fixturePath(db)),
  );
  if (
    value.runId !== runId ||
    value.instanceId !== db.config.instanceId ||
    !value.prepared
  )
    throw fail();
  if (value.review) await verifyInternalReviewReceipt(value.review);
  if (value.versionDetail)
    await verifyInternalVersionDetail(value.versionDetail);
  return value;
}
export async function prepareInternalVersionFixture(
  db: TestDatabase,
  runId: string,
): Promise<InternalVersionFixture> {
  requireTest(db);
  z.uuid().parse(runId);
  await absent(fixturePath(db));
  const [existing] = await db.admin.sql<
    { present: boolean }[]
  >`SELECT EXISTS(SELECT 1 FROM qf.product WHERE id='internal-version-fixture') AS present`;
  if (existing?.present !== false) throw fail();
  const value: InternalVersionFixture = {
    version: 1,
    qualification: "synthetic-db-and-private-pixels-no-native",
    instanceId: db.config.instanceId,
    runId,
    writerPid: process.pid,
    prepared: false,
    completed: false,
    productId: "internal-version-fixture",
    draftId: null,
    initialIdempotencyKey: null,
    initial: null,
    target: null,
    operator: {
      identifier: randomUUID(),
      secret: issueToken("credential").raw,
    },
    readOnly: {
      identifier: randomUUID(),
      secret: issueToken("credential").raw,
    },
    baseline: null,
    renderer: null,
    engine: null,
    sources: [],
    blobs: [],
    review: null,
    versionDetail: null,
  };
  await save(db, value, true);
  for (const [actor, role] of [
    [value.operator, "admin"],
    [value.readOnly, "read-only"],
  ] as const)
    await seedVersionFixtureAccount(
      db,
      actor,
      `p3e-e2e-${runId}-${role}`,
      role,
    );
  const session = await loginVersionFixtureAccount(db, value.operator);
  const auth = {
    id: value.operator.identifier,
    credentials: {
      sessionToken: session.raw,
      csrfToken: session.dto.csrfToken,
      requestId: randomUUID(),
    },
  };
  for (const [name, ordinal] of [
    ["baseline", 1],
    ["next", 2],
  ] as const) {
    const prepared = await prepareP3eSource(`${runId}:${name}`, ordinal),
      source = await seedReadyP2b3Source(db, auth, prepared, {
        createProduct: name === "baseline",
      }),
      f = prepared.candidate.facts;
    if (name === "baseline") {
      const applied = await createProductDraftService().applyReadyValidation(
        db.app,
        auth.credentials,
        source.scope,
        source.input,
      );
      const {
        idempotencyKey,
        expectedValidationStateRevision: _state,
        expectedCandidateSha256: _candidate,
        fingerprint: _fingerprint,
        target: _target,
        ...summary
      } = applied.application;
      void _state;
      void _candidate;
      void _fingerprint;
      void _target;
      value.draftId = applied.application.draftId;
      value.initialIdempotencyKey = idempotencyKey;
      value.initial = summary;
      value.target = {
        draftId: value.draftId,
        revision: 1,
        canonicalContentSha256: f.canonicalContentSha256,
        assetSetSha256: f.assetSetSha256,
        canonicalManifestSha256: f.canonicalManifestSha256,
      };
      const baseline = matchRegisteredBaseline(f, db.config.purpose);
      if (!baseline || baseline.descriptor.approval.kind !== "synthetic-test")
        throw fail();
      value.baseline = baseline.identity;
      value.renderer = rendererIdentitySchema.parse(
        implementationIdentity(IMPLEMENTATION_DESCRIPTORS.renderers[0]!),
      );
      value.engine = engineIdentitySchema.parse(
        implementationIdentity(
          IMPLEMENTATION_DESCRIPTORS.engines.find(
            (e) => e.descriptor.id === "archetype",
          )!,
        ),
      );
      const lock = await StorageLock.acquire(db.config);
      let unconfirmed = false;
      try {
        await ensureStorage(db.config);
        for (const blob of prepared.blobs) {
          const file = blobPath(db.config, blob.sha256),
            asset = prepared.assetFiles.find((a) =>
              f.resources.some(
                (r) =>
                  r.blobSha256 === blob.sha256 && r.declaration.path === a.path,
              ),
            );
          if (!asset) throw fail();
          let created = false;
          try {
            const h = await open(
              file,
              constants.O_WRONLY |
                constants.O_CREAT |
                constants.O_EXCL |
                constants.O_NOFOLLOW,
              0o600,
            );
            created = true;
            try {
              await h.writeFile(asset.bytes);
              await h.sync();
            } finally {
              try {
                await h.close();
              } catch (error) {
                unconfirmed = true;
                quarantined.push(h, lock);
                throw error;
              }
            }
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
          }
          await readPrivateResource(
            db.config,
            {
              resourceRef: {
                productId: value.productId,
                id: "fixture-verification",
                version: "1.0.0",
              },
              sha256: blob.sha256,
              bytes: blob.bytes,
              mediaType: blob.mediaType,
              width: blob.width,
              height: blob.height,
            },
            () => lock.assert(),
            () => {},
            (h) => {
              unconfirmed = true;
              quarantined.push(h, lock);
            },
          );
          value.blobs.push({ sha256: blob.sha256, bytes: blob.bytes, created });
        }
      } finally {
        if (!unconfirmed && !(await lock.close())) {
          quarantined.push(lock);
          throw fail();
        }
      }
    }
    value.sources.push({
      name,
      scope: source.scope,
      expectedValidationStateRevision:
        source.input.expectedValidationStateRevision,
      expectedCandidateSha256: source.input.expectedCandidateSha256,
      canonicalContentSha256: f.canonicalContentSha256,
      assetSetSha256: f.assetSetSha256,
      canonicalManifestSha256: f.canonicalManifestSha256,
      packVersion: name === "baseline" ? "1.0.1" : "1.0.2",
    });
  }
  value.prepared = true;
  await save(db, value);
  return value;
}

async function observeGraph(db: TestDatabase, value: InternalVersionFixture) {
  return db.admin.sql.begin(
    "isolation level repeatable read read only",
    async (tx) => {
      await tx`SET LOCAL statement_timeout='5s'`;
      await tx`SET LOCAL transaction_timeout='10s'`;
      const root = await draftRoot(tx, value.productId);
      if (
        !root ||
        root.id !== value.draftId ||
        root.created_by !== value.operator.identifier ||
        ![1, 2].includes(root.current_revision)
      )
        throw fail();
      const revisions = [];
      for (let n = 1; n <= root.current_revision; n++) {
        const r = await revisionMetadata(tx, value.productId, root.id, n),
          s = value.sources.find(
            (s) => s.name === (n === 1 ? "baseline" : "next"),
          );
        if (
          !r ||
          !s ||
          r.created_by !== value.operator.identifier ||
          r.source_import_id !== s.scope.sourceImportId ||
          r.source_validation_id !== s.scope.sourceValidationId ||
          r.source_validation_state_revision !==
            s.expectedValidationStateRevision ||
          r.candidate_sha256 !== s.expectedCandidateSha256 ||
          r.canonical_content_sha256 !== s.canonicalContentSha256 ||
          r.asset_set_sha256 !== s.assetSetSha256 ||
          r.canonical_manifest_sha256 !== s.canonicalManifestSha256
        )
          throw fail();
        revisions.push(r);
      }
      const first = await applicationByKey(
        tx,
        value.productId,
        value.initialIdempotencyKey!,
      );
      if (
        !first ||
        first.target_kind !== "new-draft" ||
        !same(summaryDto(first), value.initial)
      )
        throw fail();
      applicationDto(first);
      const sourceProofs = [];
      for (const s of value.sources) {
        const p = await readFrozenDraftSourceEvidenceReadonly(tx, s.scope, {
          expectedValidationStateRevision: s.expectedValidationStateRevision,
          expectedCandidateSha256: s.expectedCandidateSha256,
        });
        if (
          p.canonicalContentSha256 !== s.canonicalContentSha256 ||
          p.assetSetSha256 !== s.assetSetSha256 ||
          p.canonicalManifestSha256 !== s.canonicalManifestSha256
        )
          throw fail();
        sourceProofs.push(p);
      }
      await assertExactGraphSets(tx, value, revisions, sourceProofs);
      const reviews = await tx<
          ReviewRow[]
        >`SELECT * FROM qf.draft_review WHERE product_id=${value.productId} LIMIT 101`,
        versions = await tx<
          VersionRow[]
        >`SELECT * FROM qf.product_version WHERE product_id=${value.productId} LIMIT 101`;
      if (reviews.length !== 1 || versions.length !== 1) throw fail();
      const review = await reviewReceipt(reviews[0]!),
        detail = await versionDetail(versions[0]!);
      if (
        review.recordedBy !== value.operator.identifier ||
        !same(review.binding.target, value.target) ||
        !same(review.binding.baseline, value.baseline) ||
        review.facts.approval.kind !== "synthetic-test" ||
        detail.version.createdBy !== value.operator.identifier ||
        !same(detail.version.binding.renderer, value.renderer) ||
        !same(detail.version.binding.engine, value.engine) ||
        detail.version.binding.reviewId !== review.id ||
        detail.version.binding.reviewSha256 !== review.reviewSha256 ||
        buildInternalSnapshot(detail.version.binding, review, sourceProofs[0]!)
          .text !== internalSnapshotText(detail.snapshot)
      )
        throw fail();
      return { root, revisions, sourceProofs, review, detail };
    },
  );
}

/** Full Product collections, not merely the subset named in the private file. Runs before any DELETE/unlink. */
async function assertExactGraphSets(
  tx: postgres.TransactionSql,
  value: InternalVersionFixture,
  revisions: readonly DraftRevisionRow[],
  proofs: readonly ReadyDraftSourceEvidence[],
) {
  const imports = await tx<
    (ImportRow & { target_kind: string })[]
  >`SELECT * FROM qf.quizpack_import WHERE product_id=${value.productId} LIMIT 3`;
  const validations = await tx<
    ValidationRow[]
  >`SELECT * FROM qf.quizpack_validation WHERE product_id=${value.productId} LIMIT 3`;
  if (
    imports.length !== value.sources.length ||
    validations.length !== value.sources.length
  )
    throw fail();
  for (const s of value.sources) {
    const imported = imports.find((i) => i.id === s.scope.sourceImportId),
      validation = validations.find((v) => v.id === s.scope.sourceValidationId),
      proof = proofs.find(
        (p) =>
          p.sourceImportId === s.scope.sourceImportId &&
          p.sourceValidationId === s.scope.sourceValidationId,
      );
    if (
      !imported ||
      !validation ||
      !proof ||
      imported.created_by !== value.operator.identifier ||
      imported.status !== "received" ||
      imported.target_kind !== "new-draft" ||
      imported.storage_condition !== "clean" ||
      String(imported.reserved_bytes) !== "0" ||
      imported.lease_until !== null ||
      imported.actual_archive_sha256 !== proof.validation.archiveSha256 ||
      imported.expected_archive_sha256 !== proof.validation.archiveSha256 ||
      imported.actual_archive_bytes !== 100 ||
      imported.expected_archive_bytes !== 100 ||
      imported.archive_storage_key !==
        `imports/${imported.id}/archive.quizpack` ||
      validation.created_by !== value.operator.identifier ||
      validation.import_id !== imported.id ||
      validation.status !== "ready" ||
      validation.storage_condition !== "clean" ||
      String(validation.reserved_bytes) !== "0" ||
      validation.lease_until !== null ||
      validation.state_revision !== s.expectedValidationStateRevision ||
      validation.candidate_sha256 !== s.expectedCandidateSha256 ||
      validation.canonical_content_sha256 !== s.canonicalContentSha256 ||
      validation.asset_set_sha256 !== s.assetSetSha256 ||
      validation.canonical_manifest_sha256 !== s.canonicalManifestSha256
    )
      throw fail();
  }
  const actualRevisions = await tx<
    {
      draft_id: string;
      revision: number;
      application_id: string;
      created_by: string;
    }[]
  >`SELECT draft_id,revision,application_id,created_by FROM qf.draft_revision WHERE product_id=${value.productId} ORDER BY revision LIMIT 101`;
  const applications = await tx<
    ApplicationRow[]
  >`SELECT * FROM qf.draft_application WHERE product_id=${value.productId} ORDER BY revision LIMIT 101`;
  if (
    actualRevisions.length !== revisions.length ||
    applications.length !== revisions.length
  )
    throw fail();
  for (const r of revisions) {
    const actual = actualRevisions.find(
        (a) => a.draft_id === r.draft_id && a.revision === r.revision,
      ),
      application = applications.find(
        (a) =>
          a.id === r.application_id &&
          a.draft_id === r.draft_id &&
          a.revision === r.revision,
      ),
      s = value.sources.find(
        (s) => s.name === (r.revision === 1 ? "baseline" : "next"),
      );
    if (
      !actual ||
      !application ||
      !s ||
      actual.application_id !== r.application_id ||
      actual.created_by !== value.operator.identifier ||
      application.created_by !== value.operator.identifier ||
      application.source_import_id !== s.scope.sourceImportId ||
      application.source_validation_id !== s.scope.sourceValidationId ||
      application.expected_validation_state_revision !==
        s.expectedValidationStateRevision ||
      application.expected_candidate_sha256 !== s.expectedCandidateSha256 ||
      application.target_kind !==
        (r.revision === 1 ? "new-draft" : "append-revision") ||
      (r.revision === 1 &&
        (application.idempotency_key !== value.initialIdempotencyKey ||
          application.expected_draft_revision !== null ||
          application.expected_base_content_sha256 !== null ||
          application.expected_base_asset_set_sha256 !== null)) ||
      (r.revision === 2 &&
        (application.expected_draft_revision !== 1 ||
          application.expected_base_content_sha256 !==
            value.target!.canonicalContentSha256 ||
          application.expected_base_asset_set_sha256 !==
            value.target!.assetSetSha256))
    )
      throw fail();
  }
  const baseline = value.sources.find((s) => s.name === "baseline")!,
    source = proofs.find(
      (p) => p.sourceValidationId === baseline.scope.sourceValidationId,
    )!;
  const content = JSON.parse(source.canonicalContentText) as {
    resources: { id: string; version: string; purpose: string }[];
  };
  const assets = await tx<
    {
      resource_id: string;
      resource_version: string;
      blob_sha256: string;
      declaration_sha256: string;
      declaration_text: string;
      source_validation_id: string;
      purpose: string;
      platform_approval: string;
    }[]
  >`SELECT resource_id,resource_version,blob_sha256,declaration_sha256,declaration_text,source_validation_id,purpose,platform_approval FROM qf.product_asset WHERE product_id=${value.productId} LIMIT 65`;
  if (
    assets.length !== source.resources.length ||
    value.blobs.length !== new Set(source.resources.map((r) => r.sha256)).size
  )
    throw fail();
  for (const r of source.resources) {
    const asset = assets.find(
        (a) =>
          a.resource_id === r.resourceRef.id &&
          a.resource_version === r.resourceRef.version,
      ),
      declaration = content.resources.find(
        (d) => d.id === r.resourceRef.id && d.version === r.resourceRef.version,
      ),
      blob = value.blobs.find((b) => b.sha256 === r.sha256);
    if (
      !asset ||
      !declaration ||
      !blob ||
      blob.bytes !== r.bytes ||
      asset.blob_sha256 !== r.sha256 ||
      asset.declaration_sha256 !== r.declarationSha256 ||
      asset.declaration_text !== canonicalP1Json(declaration) ||
      asset.source_validation_id !== baseline.scope.sourceValidationId ||
      asset.purpose !== declaration.purpose ||
      asset.platform_approval !== "unverified"
    )
      throw fail();
  }
  const [product] = await tx<
    { exact: boolean }[]
  >`SELECT slug=${value.productId} AND title='B3 synthetic SQL product' AND primary_category_id IS NULL AND NOT EXISTS(SELECT 1 FROM qf.product_tag WHERE product_id=${value.productId}) AS exact FROM qf.product WHERE id=${value.productId}`;
  if (product?.exact !== true) throw fail();
}
export async function finishInternalVersionFixture(
  db: TestDatabase,
  runId: string,
) {
  const value = await readInternalVersionFixture(db, runId),
    observed = await observeGraph(db, value);
  if (
    value.completed &&
    (!same(value.review, observed.review) ||
      !same(value.versionDetail, observed.detail))
  )
    throw fail();
  value.review = observed.review;
  value.versionDetail = observed.detail;
  value.completed = true;
  await save(db, value);
  return value;
}
export async function cleanupInternalVersionFixture(
  db: TestDatabase,
  runId: string,
  proof: ServerExitProof,
) {
  requireTest(db);
  assertServerExitProof(proof, {
    cwd: process.cwd(),
    instanceId: db.config.instanceId,
    runId,
  });
  const value = await readInternalVersionFixture(db, runId);
  if (
    !value.completed ||
    !value.review ||
    !value.versionDetail ||
    !ownerAbsent(value.writerPid)
  )
    throw fail();
  const live = await currentConfig(db.app);
  if (live.imports.enabled) throw fail();
  await assertNoConfigGuard(live);
  await db.app.close();
  const controller = new AbortController(),
    { context, dispose } = createReceiveContext(controller.signal),
    lock = await StorageLock.acquire(live, context);
  let unconfirmed = false;
  try {
    const check = async () => {
      remainingReceiveMs(context);
      assertServerExitProof(proof, {
        cwd: process.cwd(),
        instanceId: db.config.instanceId,
        runId,
      });
      if (
        !ownerAbsent(value.writerPid) ||
        (await currentConfig(db.app)).imports.enabled
      )
        throw fail();
      await assertNoConfigGuard(live);
      await lock.check();
      const [pid] = await lock.query(
        () =>
          lock.connection<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`,
      );
      if (!pid) throw fail();
      const [other] = await db.admin.sql<
        { present: boolean }[]
      >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid() AND pid<>${pid.pid}) AS present`;
      if (other?.present !== false) throw fail();
      return inspectPreviewNativeControl(value.qualification);
    };
    await check();
    const graph = await observeGraph(db, value);
    if (
      !same(graph.review, value.review) ||
      !same(graph.detail, value.versionDetail)
    )
      throw fail();
    const actors = [value.operator.identifier, value.readOnly.identifier];
    const operatorRows = await db.admin.sql<
      { id: string; label: string; credential_digest: string; role: string }[]
    >`SELECT id,label,credential_digest,role FROM qf.operator WHERE id=ANY(${db.admin.sql.array(actors)}::uuid[])`;
    if (
      operatorRows.length !== 2 ||
      operatorRows.some((a) => {
        const operator = a.id === value.operator.identifier;
        return (
          a.label !== `p3e-e2e-${runId}-${operator ? "admin" : "read-only"}` ||
          a.role !== (operator ? "admin" : "read-only") ||
          a.credential_digest !==
            digestToken(
              operator ? value.operator.secret : value.readOnly.secret,
              "credential",
            )
        );
      })
    )
      throw fail();
    const [foreign] = await db.admin.sql<
      { present: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM qf.draft_application WHERE created_by=ANY(${db.admin.sql.array(actors)}::uuid[]) AND product_id<>${value.productId}) OR EXISTS(SELECT 1 FROM qf.quizpack_import WHERE created_by=ANY(${db.admin.sql.array(actors)}::uuid[]) AND product_id<>${value.productId}) OR EXISTS(SELECT 1 FROM qf.quizpack_validation WHERE created_by=ANY(${db.admin.sql.array(actors)}::uuid[]) AND product_id<>${value.productId}) OR EXISTS(SELECT 1 FROM qf.draft_review WHERE recorded_by=ANY(${db.admin.sql.array(actors)}::uuid[]) AND product_id<>${value.productId}) OR EXISTS(SELECT 1 FROM qf.product_version WHERE created_by=ANY(${db.admin.sql.array(actors)}::uuid[]) AND product_id<>${value.productId}) OR EXISTS(SELECT 1 FROM qf.quizpack_validation WHERE reserved_bytes>0) OR EXISTS(SELECT 1 FROM qf.quizpack_import WHERE reserved_bytes>0) AS present`;
    if (foreign?.present !== false) throw fail();
    const sessions = await db.admin.sql<
        { id: string }[]
      >`SELECT id FROM qf.operator_session WHERE operator_id=ANY(${db.admin.sql.array(actors)}::uuid[]) LIMIT 1025`,
      audit = await db.admin.sql<
        FixtureAuditTarget[]
      >`SELECT id,action,actor_id,session_id,target_kind,target_id,target_revision FROM qf.audit_event WHERE actor_id=ANY(${db.admin.sql.array(actors)}::uuid[]) LIMIT 8193`;
    if (sessions.length > 1024 || audit.length > 8192) throw fail();
    for (const e of audit) {
      if (["draft", "review", "version"].includes(e.target_kind ?? "")) {
        if (
          e.actor_id !== value.operator.identifier ||
          !sessions.some((s) => s.id === e.session_id) ||
          (e.target_kind === "draft" &&
            (e.action !== "draft_applied" ||
              e.target_id !== value.draftId ||
              !graph.revisions.some(
                (r) => r.revision === e.target_revision,
              ))) ||
          (e.target_kind === "review" &&
            (e.action !== "draft_baseline_recorded" ||
              e.target_id !== value.review.id ||
              e.target_revision !== 1)) ||
          (e.target_kind === "version" &&
            (e.action !== "internal_version_sealed" ||
              e.target_id !== value.versionDetail.version.id ||
              e.target_revision !== 1))
        )
          throw fail();
      } else if (
        !fixtureAuditAllowed(e, {
          productId: value.productId,
          importIds: new Set(value.sources.map((s) => s.scope.sourceImportId)),
          validationIds: new Set(
            value.sources.map((s) => s.scope.sourceValidationId),
          ),
          actorIds: new Set(actors),
          sessionIds: new Set(sessions.map((s) => s.id)),
        })
      )
        throw fail();
    }
    for (const s of value.sources) {
      await absent(importDirectory(live, s.scope.sourceImportId));
      await absent(validationDirectory(live, s.scope.sourceValidationId));
    }
    const scope = {
      revisions: graph.revisions.map((r) => ({
        productId: r.product_id,
        draftId: r.draft_id,
        revision: r.revision,
      })),
      imports: value.sources.map((s) => ({
        productId: value.productId,
        id: s.scope.sourceImportId,
      })),
      validations: value.sources.map((s) => ({
        productId: value.productId,
        id: s.scope.sourceValidationId,
      })),
      blobSha256: value.blobs.map((b) => b.sha256),
    };
    // All external ledgers are checked BEFORE deleting even the fixture's own review/version.
    await assertOnlyOwnedInternalReferences(lock, scope, {
      reviews: [value.review],
      versions: [value.versionDetail.version],
    });
    const scan = await scanStorage(live, context),
      remove: ReturnType<typeof scannedFiles> = [],
      deletable: string[] = [];
    for (const blob of value.blobs) {
      const [shared] = await db.admin.sql<
        { present: boolean }[]
      >`SELECT EXISTS(SELECT 1 FROM qf.product_asset WHERE product_id<>${value.productId} AND blob_sha256=${blob.sha256}) OR EXISTS(SELECT 1 FROM qf.quizpack_validation v CROSS JOIN LATERAL jsonb_to_recordset(v.asset_set_text::jsonb->'resources') r("blobSha256" text) WHERE v.product_id<>${value.productId} AND r."blobSha256"=${blob.sha256}) AS present`;
      if (!shared) throw fail();
      if (!blob.created) {
        if (!shared.present) throw fail();
        continue;
      }
      if (shared.present) throw fail();
      const found = scannedFiles(scan, "blobs", blob.sha256),
        resource = graph.sourceProofs[0]!.resources.find(
          (r) => r.sha256 === blob.sha256,
        );
      if (found.length !== 1 || !resource || resource.bytes !== blob.bytes)
        throw fail();
      await readPrivateResource(
        live,
        resource,
        () => {
          remainingReceiveMs(context);
          lock.assert();
        },
        () => controller.abort(),
        (h) => {
          unconfirmed = true;
          quarantined.push(h, lock);
        },
      );
      remove.push(found[0]!);
      deletable.push(blob.sha256);
    }
    await check();
    // These exact removals are already proved owned under the exclusive lock; no Product-wide exception.
    await db.admin.sql.begin(async (tx) => {
      await acquireAuthWriteLock(tx);
      const versions =
        await tx`DELETE FROM qf.product_version WHERE id=${value.versionDetail!.version.id} AND product_id=${value.productId} AND fingerprint=${value.versionDetail!.version.fingerprint} AND snapshot_sha256=${value.versionDetail!.version.snapshotSha256} AND created_by=${value.operator.identifier} RETURNING id`;
      const reviews =
        await tx`DELETE FROM qf.draft_review WHERE id=${value.review!.id} AND product_id=${value.productId} AND fingerprint=${value.review!.fingerprint} AND review_sha256=${value.review!.reviewSha256} AND recorded_by=${value.operator.identifier} RETURNING id`;
      if (versions.length !== 1 || reviews.length !== 1) throw fail();
    });
    await assertNoRetainedInternalReferences(lock, {
      ...scope,
      blobSha256: deletable,
    });
    for (const file of remove) await removeOwned(file.file, file.inode);
    await lock.check();
    await db.admin.sql.begin(async (tx) => {
      await acquireAuthWriteLock(tx);
      await tx`DELETE FROM qf.product_draft WHERE product_id=${value.productId}`;
      await tx`DELETE FROM qf.draft_revision WHERE product_id=${value.productId}`;
      await tx`DELETE FROM qf.draft_application WHERE product_id=${value.productId}`;
      await tx`DELETE FROM qf.product_asset WHERE product_id=${value.productId}`;
      await tx`DELETE FROM qf.quizpack_validation WHERE product_id=${value.productId}`;
      await tx`DELETE FROM qf.quizpack_import WHERE product_id=${value.productId} AND created_by=${value.operator.identifier}`;
      await tx`DELETE FROM qf.product_tag WHERE product_id=${value.productId}`;
      await tx`DELETE FROM qf.product WHERE id=${value.productId}`;
      if (deletable.length)
        await tx`DELETE FROM qf.asset_blob WHERE sha256=ANY(${tx.array(deletable)}) AND NOT EXISTS(SELECT 1 FROM qf.product_asset WHERE blob_sha256=qf.asset_blob.sha256)`;
      await tx`DELETE FROM qf.audit_event WHERE id=ANY(${tx.array(audit.map((e) => e.id))}::uuid[]) AND actor_id=ANY(${tx.array(actors)}::uuid[])`;
      await tx`DELETE FROM qf.operator_session WHERE id=ANY(${tx.array(sessions.map((s) => s.id))}::uuid[]) AND operator_id=ANY(${tx.array(actors)}::uuid[])`;
      await tx`DELETE FROM qf.operator WHERE id=ANY(${tx.array(actors)}::uuid[])`;
    });
    await unlink(fixturePath(db));
    return {
      nativeControl: await inspectPreviewNativeControl(value.qualification),
    };
  } finally {
    dispose();
    if (!unconfirmed && !(await lock.close())) {
      quarantined.push(lock);
      throw fail();
    }
  }
}
async function main() {
  const [action, runId] = process.argv.slice(2);
  if (!["prepare", "finish"].includes(action ?? "")) throw fail();
  z.uuid().parse(runId);
  const db = await openTestDatabase();
  try {
    if (action === "prepare") {
      await absent(fixturePath(db));
      await waitForPreviewAuthBudget(db);
      const value = await prepareInternalVersionFixture(db, runId!);
      process.stdout.write(
        JSON.stringify({
          prepared: value.prepared,
          productId: value.productId,
          draftId: value.draftId,
        }) + "\n",
      );
    } else {
      const value = await finishInternalVersionFixture(db, runId!);
      process.stdout.write(
        JSON.stringify({
          completed: value.completed,
          reviewId: value.review?.id,
          versionId: value.versionDetail?.version.id,
        }) + "\n",
      );
    }
  } finally {
    await db.close();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  safeTestOperation(main).catch(() => {
    process.stderr.write("INTERNAL_VERSION_FIXTURE_FAILED\n");
    process.exitCode = 1;
  });
