import {
  seedVersionFixtureAccount,
  loginVersionFixtureAccount,
  fixtureAccountMatches,
  type FixtureAccountRow,
} from "./version-account-fixture";
import { assertNoRetainedInternalReferences } from "@/features/product/internal-versions/retention";
import { constants } from "node:fs";
import { open, lstat, unlink, rename } from "node:fs/promises";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { readPrivateJson } from "@/lib/db/runtime";
import { acquireAuthWriteLock } from "@/lib/db/auth-lock";
import { createDatabase } from "@/lib/db/client";
import { configureImports } from "@/features/quizpack/import/config-management";
import { currentConfig } from "@/features/quizpack/import/service";
import { StorageLock } from "@/features/quizpack/import/storage-lock";
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
import { createReceiveContext } from "@/features/quizpack/import/context";
import {
  parseValidationAttempts,
  type ValidationRow,
} from "@/features/quizpack/validation/repository";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import { createProductDraftService } from "@/features/product/drafts/service";
import {
  summaryDto,
  revisionMetadata,
  draftRoot,
} from "@/features/product/drafts/repository";
import { readReadyDraftSourceReadonly } from "@/features/quizpack/draft-source";
import { readFixedPreviewSource } from "@/features/product/preview/repository";
import { readPrivateResource } from "@/features/quizpack/resource-read/storage";
import {
  assertServerExitProof,
  type ServerExitProof,
} from "../support/p3c-server-owner";
import { waitForPreviewAuthBudget } from "./p3c-auth-budget";
import { prepareP3dSource } from "./p3d-source-fixture";
import { seedReadyP2b3Source } from "./p2b3-fixture";
import { syntheticFileStopProof } from "./p2b2b-domain-fixture";
import {
  fixtureAuditAllowed,
  type FixtureAuditTarget,
} from "./p2b2b-maintenance";
import { ownerAbsent } from "./p2b2b-fixture-contract";
import {
  openTestDatabase,
  safeTestOperation,
  type TestDatabase,
} from "./p2a-fixture";
import {
  inspectPreviewNativeControl,
  type PreviewNativeControlStatus,
} from "./p3c-native-control";
import {
  DRAFT_REVISION_FIXTURE_PRIVATE_NAME,
  DRAFT_REVISION_FIXTURE_MAX_BYTES,
  draftRevisionFixtureSchema,
  type DraftRevisionFixture,
} from "./p3d-draft-revision-fixture-contract";
export {
  DRAFT_REVISION_FIXTURE_PRIVATE_NAME,
  draftRevisionFixtureSchema,
  type DraftRevisionFixture,
} from "./p3d-draft-revision-fixture-contract";
const fixturePath = (db: TestDatabase) =>
  path.join(instanceDirectory(db.config), DRAFT_REVISION_FIXTURE_PRIVATE_NAME);
const fail = () => Error("DRAFT_REVISION_FIXTURE_UNKNOWN_PRESERVED");
function requireTest(db: TestDatabase) {
  if (!["test", "ci"].includes(db.config.purpose)) throw fail();
}
const same = (a: unknown, b: unknown) =>
  canonicalP1Json(a) === canonicalP1Json(b);
async function absent(file: string) {
  try {
    await lstat(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  throw fail();
}
/** The first writer reserves O_EXCL; updates fsync a new private inode and atomically rename it. */
async function save(
  db: TestDatabase,
  value: DraftRevisionFixture,
  create = false,
) {
  const bytes = Buffer.from(
    JSON.stringify(draftRevisionFixtureSchema.parse(value)),
  );
  if (bytes.length > DRAFT_REVISION_FIXTURE_MAX_BYTES) throw fail();
  const file = fixturePath(db),
    old = create ? undefined : await lstat(file);
  if (old) {
    privateFile(old);
    if (old.nlink !== 1) throw fail();
  }
  const target = create ? file : `${file}.tmp-${randomUUID()}`,
    h = await open(
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
  if (old) {
    const current = await lstat(file);
    privateFile(current);
    if (
      current.dev !== old.dev ||
      current.ino !== old.ino ||
      current.nlink !== 1
    )
      throw fail();
    await rename(target, file);
  }
}
export async function readDraftRevisionFixture(
  db: TestDatabase,
  runId: string,
): Promise<DraftRevisionFixture> {
  requireTest(db);
  z.uuid().parse(runId);
  const st = await lstat(fixturePath(db));
  privateFile(st);
  if (st.nlink !== 1 || st.size > DRAFT_REVISION_FIXTURE_MAX_BYTES)
    throw fail();
  const value = draftRevisionFixtureSchema.parse(
    await readPrivateJson(fixturePath(db)),
  );
  if (
    value.runId !== runId ||
    value.instanceId !== db.config.instanceId ||
    !value.prepared
  )
    throw fail();
  return value;
}
export async function prepareDraftRevisionFixture(
  db: TestDatabase,
  runId: string,
): Promise<DraftRevisionFixture> {
  requireTest(db);
  z.uuid().parse(runId);
  const value: DraftRevisionFixture = {
    version: 1,
    qualification: "synthetic-db-and-private-pixels-no-native",
    instanceId: db.config.instanceId,
    runId,
    writerPid: process.pid,
    prepared: false,
    completed: false,
    productId: `revisions-${runId.slice(0, 8)}`,
    draftId: null,
    initialIdempotencyKey: null,
    initial: null,
    operator: {
      identifier: randomUUID(),
      secret: randomBytes(32).toString("base64url"),
    },
    readOnly: {
      identifier: randomUUID(),
      secret: randomBytes(32).toString("base64url"),
    },
    blobs: [],
    sources: [],
  };
  await save(db, value, true);
  await configureImports(db.config.instanceId, true);
  try {
    for (const [a, role] of [
      [value.operator, "operator"],
      [value.readOnly, "read-only"],
    ] as const)
      await seedVersionFixtureAccount(db, a, `p3d-e2e-${runId}-${role}`, role);
    const session = await loginVersionFixtureAccount(db, value.operator),
      auth = {
        id: value.operator.identifier,
        credentials: {
          sessionToken: session.raw,
          csrfToken: session.dto.csrfToken,
          requestId: randomUUID(),
        },
      };
    for (const [name, ordinal] of [
      ["initial", 1],
      ["second", 2],
      ["third", 3],
      ["spare", 4],
      ["alias-initial", 1],
    ] as const) {
      const prepared = await prepareP3dSource(
          value.productId,
          ordinal,
          `p3d:${runId}`,
        ),
        ready = await seedReadyP2b3Source(db, auth, prepared, {
          createProduct: name === "initial",
        });
      if (name === "initial") {
        const applied = await createProductDraftService().applyReadyValidation(
          db.app,
          auth.credentials,
          ready.scope,
          ready.input,
        );
        value.draftId = applied.application.draftId;
        value.initialIdempotencyKey = applied.application.idempotencyKey;
        const {
          idempotencyKey: _key,
          expectedValidationStateRevision: _state,
          expectedCandidateSha256: _candidate,
          fingerprint: _fingerprint,
          target: _target,
          ...summary
        } = applied.application;
        void _key;
        void _state;
        void _candidate;
        void _fingerprint;
        void _target;
        value.initial = summary;
        const lock = await StorageLock.acquire(db.config);
        try {
          await ensureStorage(db.config);
          for (const blob of prepared.blobs) {
            const file = blobPath(db.config, blob.sha256),
              asset = prepared.assetFiles.find(
                (a) =>
                  createHash("sha256").update(a.bytes).digest("hex") ===
                  blob.sha256,
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
                await h.close();
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
              () => {},
            );
            value.blobs.push({
              sha256: blob.sha256,
              bytes: blob.bytes,
              created,
            });
          }
        } finally {
          await lock.close();
        }
      }
      const facts = prepared.candidate.facts;
      value.sources.push({
        name,
        scope: ready.scope,
        expectedValidationStateRevision:
          ready.input.expectedValidationStateRevision,
        expectedCandidateSha256: ready.input.expectedCandidateSha256,
        canonicalContentSha256: facts.canonicalContentSha256,
        assetSetSha256: facts.assetSetSha256,
        canonicalManifestSha256: facts.canonicalManifestSha256,
        packVersion: facts.packVersion,
        witnesses: facts.content.results.map((r) => ({
          resultId: r.id,
          answers: r.witness.answers.map((a) => ({
            questionId: a.questionRef.id,
            optionId: a.optionRef.id,
          })),
        })),
      });
      await save(db, value);
    }
    value.prepared = true;
    await verifySources(db, value, 1);
    await save(db, value);
    return draftRevisionFixtureSchema.parse(value);
  } finally {
    await configureImports(db.config.instanceId, false);
  }
}
/** Exact prepared/final graph, including unused ready sources and unchanged original asset ownership. */
async function verifySources(
  db: TestDatabase,
  value: DraftRevisionFixture,
  current: 1 | 3,
) {
  const initial = value.sources.find((s) => s.name === "initial");
  if (!initial || !value.draftId || !value.initial) throw fail();
  await db.admin.sql.begin(
    "isolation level repeatable read read only",
    async (tx) => {
      const root = await draftRoot(tx, value.productId);
      if (
        !root ||
        root.id !== value.draftId ||
        root.current_revision !== current ||
        root.initial_application_id !== value.initial!.applicationId
      )
        throw fail();
      const first = await revisionMetadata(
        tx,
        value.productId,
        value.draftId!,
        1,
      );
      if (!first || !same(summaryDto(first), value.initial)) throw fail();
      const [counts] = await tx<
        {
          imports: number;
          validations: number;
          roots: number;
          revisions: number;
          applications: number;
        }[]
      >`SELECT (SELECT count(*)::int FROM qf.quizpack_import WHERE product_id=${value.productId}) imports,(SELECT count(*)::int FROM qf.quizpack_validation WHERE product_id=${value.productId}) validations,(SELECT count(*)::int FROM qf.product_draft WHERE product_id=${value.productId}) roots,(SELECT count(*)::int FROM qf.draft_revision WHERE product_id=${value.productId}) revisions,(SELECT count(*)::int FROM qf.draft_application WHERE product_id=${value.productId}) applications`;
      if (
        !counts ||
        counts.imports !== 5 ||
        counts.validations !== 5 ||
        counts.roots !== 1 ||
        counts.revisions !== current ||
        counts.applications !== current
      )
        throw fail();
      for (const s of value.sources) {
        const facts = await readReadyDraftSourceReadonly(tx, s.scope, {
          expectedValidationStateRevision: s.expectedValidationStateRevision,
          expectedCandidateSha256: s.expectedCandidateSha256,
        });
        if (
          facts.canonicalContentSha256 !== s.canonicalContentSha256 ||
          facts.assetSetSha256 !== s.assetSetSha256 ||
          facts.canonicalManifestSha256 !== s.canonicalManifestSha256 ||
          facts.packVersion !== s.packVersion
        )
          throw fail();
        const rows = await tx<
          ValidationRow[]
        >`SELECT * FROM qf.quizpack_validation WHERE product_id=${value.productId} AND id=${s.scope.sourceValidationId}`;
        const row = rows[0];
        if (!row || row.created_by !== value.operator.identifier) throw fail();
        const attempts = parseValidationAttempts(row.attempts_text);
        if (
          attempts.length !== 1 ||
          attempts.some(
            (a) =>
              a.ownerPid !== value.writerPid ||
              a.ownerNonce !== "a".repeat(43) ||
              a.disposition !== "released" ||
              a.mediaStop !== "confirmed" ||
              !same(a.fileStopProof, syntheticFileStopProof(row, "confirmed")),
          )
        )
          throw fail();
        const [imp] =
          await tx`SELECT created_by,status,reserved_bytes,attempts FROM qf.quizpack_import WHERE product_id=${value.productId} AND id=${s.scope.sourceImportId}`;
        if (
          !imp ||
          imp.created_by !== value.operator.identifier ||
          imp.status !== "received" ||
          Number(imp.reserved_bytes) !== 0 ||
          !same(imp.attempts, [])
        )
          throw fail();
      }
      for (let n = 1; n <= current; n++) {
        const expected = value.sources.find(
          (s) => s.name === (["initial", "second", "third"] as const)[n - 1],
        );
        if (!expected) throw fail();
        const fixed = await readFixedPreviewSource(tx, {
          productId: value.productId,
          draftId: value.draftId!,
          revision: n,
        });
        const metadata = await revisionMetadata(
          tx,
          value.productId,
          value.draftId!,
          n,
        );
        if (
          !metadata ||
          metadata.created_by !== value.operator.identifier ||
          metadata.source_import_id !== expected.scope.sourceImportId ||
          metadata.source_validation_id !== expected.scope.sourceValidationId ||
          fixed.binding.canonicalContentSha256 !==
            expected.canonicalContentSha256 ||
          fixed.binding.assetSetSha256 !== expected.assetSetSha256
        )
          throw fail();
        const [app] =
          await tx`SELECT created_by,source_import_id,source_validation_id,idempotency_key FROM qf.draft_application WHERE product_id=${value.productId} AND draft_id=${value.draftId} AND revision=${n} AND id=${metadata.application_id}`;
        if (
          !app ||
          app.created_by !== value.operator.identifier ||
          app.source_import_id !== expected.scope.sourceImportId ||
          app.source_validation_id !== expected.scope.sourceValidationId ||
          (n === 1 && app.idempotency_key !== value.initialIdempotencyKey)
        )
          throw fail();
      }
      const assets = await tx<
        { source_validation_id: string; blob_sha256: string }[]
      >`SELECT source_validation_id,blob_sha256 FROM qf.product_asset WHERE product_id=${value.productId}`;
      if (
        assets.length !== value.initial!.resourceCount ||
        assets.some(
          (a) =>
            a.source_validation_id !== initial.scope.sourceValidationId ||
            !value.blobs.some((b) => b.sha256 === a.blob_sha256),
        )
      )
        throw fail();
      const [audit] =
        await tx`SELECT count(*)::int AS n,count(DISTINCT target_revision)::int AS distinct_revisions FROM qf.audit_event WHERE action='draft_applied' AND target_kind='draft' AND target_id=${value.draftId} AND actor_id=${value.operator.identifier}`;
      if (!audit || audit.n !== current || audit.distinct_revisions !== current)
        throw fail();
    },
  );
}
/** Called by the successful browser suite while Next may still be alive. Never deletes anything. */
export async function finishDraftRevisionFixture(
  db: TestDatabase,
  runId: string,
) {
  const value = await readDraftRevisionFixture(db, runId);
  if (value.completed) throw fail();
  await verifySources(db, value, 3);
  await configureImports(db.config.instanceId, false);
  const finished = { ...value, completed: true };
  await save(db, finished);
  return finished;
}
/** Only the root runner with actual process-owner proof may delete this namespace. */
export async function cleanupDraftRevisionFixture(
  db: TestDatabase,
  runId: string,
  proof: ServerExitProof,
): Promise<Readonly<{ nativeControl: PreviewNativeControlStatus }>> {
  requireTest(db);
  assertServerExitProof(proof, {
    cwd: process.cwd(),
    instanceId: db.config.instanceId,
    runId,
  });
  const value = await readDraftRevisionFixture(db, runId);
  if (!value.completed || !ownerAbsent(value.writerPid)) throw fail();
  const live = await currentConfig(db.app);
  if (live.imports.enabled) throw fail();
  const verified = await createDatabase(live);
  await verified.close();
  await verifySources(db, value, 3);
  await db.app.close();
  const lock = await StorageLock.acquire(live),
    { context, dispose } = createReceiveContext(new AbortController().signal);
  try {
    const check = async () => {
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
      const [storage] = await lock.query(
        () =>
          lock.connection<
            { pid: number }[]
          >`SELECT pg_backend_pid()::int AS pid`,
      );
      if (!storage) throw fail();
      const [other] = await db.admin.sql<
        { present: boolean }[]
      >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid() AND pid<>${storage.pid}) present`;
      if (other?.present) throw fail();
      return inspectPreviewNativeControl(value.qualification);
    };
    await check();
    const actors = [value.operator.identifier, value.readOnly.identifier];
    const [held] = await db.admin.sql<
      { present: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM qf.quizpack_validation WHERE reserved_bytes>0) OR EXISTS(SELECT 1 FROM qf.quizpack_import WHERE reserved_bytes>0) present`;
    if (held?.present) throw fail();
    const rows = await db.admin.sql<FixtureAccountRow[]>`
      SELECT id,login_name,display_name,password_hash,role FROM qf.operator
      WHERE id=ANY(${db.admin.sql.array(actors)}::uuid[])`;
    if (rows.length !== 2) throw fail();
    for (const row of rows) {
      const isOperator = row.id === value.operator.identifier;
      if (
        !(await fixtureAccountMatches(
          row,
          isOperator ? value.operator : value.readOnly,
          `p3d-e2e-${runId}-${isOperator ? "operator" : "read-only"}`,
          isOperator ? "operator" : "read-only",
        ))
      )
        throw fail();
    }
    const [foreign] = await db.admin.sql<
      { present: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM qf.draft_application WHERE created_by=ANY(${db.admin.sql.array(actors)}::uuid[]) AND product_id<>${value.productId}) OR EXISTS(SELECT 1 FROM qf.draft_revision WHERE created_by=ANY(${db.admin.sql.array(actors)}::uuid[]) AND product_id<>${value.productId}) OR EXISTS(SELECT 1 FROM qf.product_draft WHERE created_by=ANY(${db.admin.sql.array(actors)}::uuid[]) AND product_id<>${value.productId}) OR EXISTS(SELECT 1 FROM qf.quizpack_import WHERE created_by=ANY(${db.admin.sql.array(actors)}::uuid[]) AND product_id<>${value.productId}) OR EXISTS(SELECT 1 FROM qf.quizpack_validation WHERE created_by=ANY(${db.admin.sql.array(actors)}::uuid[]) AND product_id<>${value.productId}) AS present`;
    if (foreign?.present) throw fail();
    const sessions = await db.admin.sql<
        { id: string }[]
      >`SELECT id FROM qf.operator_session WHERE operator_id=ANY(${db.admin.sql.array(actors)}::uuid[]) LIMIT 1025`,
      audit = await db.admin.sql<
        FixtureAuditTarget[]
      >`SELECT id,action,actor_id,session_id,target_kind,target_id,target_revision FROM qf.audit_event WHERE actor_id=ANY(${db.admin.sql.array(actors)}::uuid[]) LIMIT 8193`;
    if (sessions.length > 1024 || audit.length > 8192) throw fail();
    for (const event of audit) {
      if (event.target_kind === "draft") {
        if (
          event.action !== "draft_applied" ||
          ![1, 2, 3].includes(event.target_revision!) ||
          event.actor_id !== value.operator.identifier ||
          event.target_id !== value.draftId ||
          !sessions.some((s) => s.id === event.session_id)
        )
          throw fail();
      } else if (
        !fixtureAuditAllowed(event, {
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
    const scan = await scanStorage(live, context),
      deletable: string[] = [],
      remove: ReturnType<typeof scannedFiles> = [];
    for (const s of value.sources) {
      await absent(importDirectory(live, s.scope.sourceImportId));
      await absent(validationDirectory(live, s.scope.sourceValidationId));
    }
    const fixed = await db.admin.sql.begin((tx) =>
      readFixedPreviewSource(tx, {
        productId: value.productId,
        draftId: value.draftId!,
        revision: 1,
      }),
    );
    for (const blob of value.blobs) {
      const [shared] = await db.admin.sql<
        { present: boolean }[]
      >`SELECT EXISTS(SELECT 1 FROM qf.product_asset WHERE product_id<>${value.productId} AND blob_sha256=${blob.sha256}) OR EXISTS(SELECT 1 FROM qf.quizpack_validation v CROSS JOIN LATERAL jsonb_to_recordset((v.asset_set_text::jsonb)->'resources') r("blobSha256" text) WHERE v.product_id<>${value.productId} AND r."blobSha256"=${blob.sha256}) present`;
      if (!shared) throw fail();
      if (shared.present) {
        if (blob.created) throw fail();
        continue;
      }
      if (!blob.created) throw fail();
      const facts = scannedFiles(scan, "blobs", blob.sha256),
        resource = fixed.content.resources.find(
          (r) => r.sha256 === blob.sha256,
        );
      if (facts.length !== 1 || !resource || resource.bytes !== blob.bytes)
        throw fail();
      await readPrivateResource(
        live,
        {
          resourceRef: {
            productId: resource.productId,
            id: resource.id,
            version: resource.version,
          },
          sha256: resource.sha256,
          bytes: resource.bytes,
          mediaType: resource.mediaType,
          width: resource.width,
          height: resource.height,
        },
        () => context.signal.throwIfAborted(),
      );
      deletable.push(blob.sha256);
      remove.push(facts[0]!);
    }
    const nativeControl = await check();
    await assertNoRetainedInternalReferences(lock, {
      revisions: [1, 2, 3].map((revision) => ({
        productId: value.productId,
        draftId: value.draftId!,
        revision,
      })),
      imports: value.sources.map((s) => ({
        productId: value.productId,
        id: s.scope.sourceImportId,
      })),
      validations: value.sources.map((s) => ({
        productId: value.productId,
        id: s.scope.sourceValidationId,
      })),
      blobSha256: deletable,
    });
    for (const fact of remove) await removeOwned(fact.file, fact.inode);
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
      await tx`DELETE FROM qf.audit_event WHERE id=ANY(${tx.array(audit.map((a) => a.id))}::uuid[]) AND actor_id=ANY(${tx.array(actors)}::uuid[])`;
      await tx`DELETE FROM qf.operator_session WHERE operator_id=ANY(${tx.array(actors)}::uuid[])`;
      await tx`DELETE FROM qf.operator WHERE id=ANY(${tx.array(actors)}::uuid[])`;
    });
    await unlink(fixturePath(db));
    return { nativeControl };
  } finally {
    dispose();
    await lock.close();
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
      await prepareDraftRevisionFixture(db, runId!);
    } else await finishDraftRevisionFixture(db, runId!);
  } finally {
    await db.close();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  safeTestOperation(main).catch(() => {
    process.stderr.write("DRAFT_REVISION_FIXTURE_FAILED\n");
    process.exitCode = 1;
  });
