import { constants } from "node:fs";
import { open, lstat, unlink } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createPreauth, login } from "@/lib/auth/service";
import { issueToken, digestToken } from "@/lib/security/p2a-tokens";
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
import { readFixedPreviewSource } from "@/features/product/preview/repository";

import { readPrivateResource } from "@/features/quizpack/resource-read/storage";
import {
  assertServerExitProof,
  type ServerExitProof,
} from "../support/p3c-server-owner";
import { waitForPreviewAuthBudget } from "./p3c-auth-budget";
import { prepareP3cSource } from "./p3c-source-fixture";
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
  PREVIEW_FIXTURE_PRIVATE_NAME,
  previewFixtureSchema,
  type PreviewFixture,
} from "./p3c-preview-fixture-contract";
export {
  PREVIEW_FIXTURE_PRIVATE_NAME,
  previewFixtureSchema,
  type PreviewFixture,
} from "./p3c-preview-fixture-contract";

const fixturePath = (db: TestDatabase) =>
  path.join(instanceDirectory(db.config), PREVIEW_FIXTURE_PRIVATE_NAME);
const fail = () => Error("PREVIEW_FIXTURE_UNKNOWN_PRESERVED");
function requireTest(db: TestDatabase) {
  if (!["test", "ci"].includes(db.config.purpose)) throw fail();
}
function same(a: unknown, b: unknown) {
  return canonicalP1Json(a) === canonicalP1Json(b);
}
async function save(db: TestDatabase, value: PreviewFixture, create = false) {
  const file = fixturePath(db);
  const handle = await open(
    file,
    constants.O_WRONLY |
      constants.O_NOFOLLOW |
      (create ? constants.O_CREAT | constants.O_EXCL : 0),
    0o600,
  );
  try {
    const st = await handle.stat();
    privateFile(st);
    if (st.nlink !== 1) throw fail();
    const bytes = Buffer.from(
      JSON.stringify(previewFixtureSchema.parse(value)),
    );
    if (bytes.length > 16384) throw fail();
    await handle.truncate(0);
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function readPreviewFixture(
  db: TestDatabase,
  runId: string,
): Promise<PreviewFixture> {
  requireTest(db);
  z.uuid().parse(runId);
  const file = fixturePath(db),
    st = await lstat(file);
  privateFile(st);
  if (st.nlink !== 1 || st.size > 16384) throw fail();
  const value = previewFixtureSchema.parse(await readPrivateJson(file));
  if (
    value.runId !== runId ||
    value.instanceId !== db.config.instanceId ||
    !value.prepared ||
    value.sources.length !== 2
  )
    throw fail();
  return value;
}
async function createActor(
  db: TestDatabase,
  a: PreviewFixture["operator"],
  role: "operator" | "read-only",
  runId: string,
) {
  await db.admin
    .sql`INSERT INTO qf.operator(id,label,credential_digest,role,status) VALUES(${a.identifier},${`p3c-e2e-${runId}-${role}`},${digestToken(a.secret, "credential")},${role},'active')`;
}
async function authenticate(db: TestDatabase, a: PreviewFixture["operator"]) {
  const pre = await createPreauth(db.app, null, randomUUID());
  const session = await login(
    db.app,
    pre.raw,
    pre.dto.csrfToken,
    a.secret,
    randomUUID(),
  );
  return {
    id: a.identifier,
    credentials: {
      sessionToken: session.raw,
      csrfToken: session.dto.csrfToken,
      requestId: randomUUID(),
    },
  };
}
export async function preparePreviewFixture(
  db: TestDatabase,
  runId: string,
): Promise<PreviewFixture> {
  requireTest(db);
  z.uuid().parse(runId);
  const operator = issueToken("credential"),
    readonly = issueToken("credential");
  const value: PreviewFixture = {
    version: 1,
    qualification: "synthetic-db-and-private-pixels-no-native",
    instanceId: db.config.instanceId,
    runId,
    writerPid: process.pid,
    prepared: false,
    completed: false,
    operator: { identifier: randomUUID(), secret: operator.raw },
    readOnly: { identifier: randomUUID(), secret: readonly.raw },
    sources: [],
  };
  await save(db, value, true); // Unknown preparation is intentionally non-retryable and preserved.
  await configureImports(db.config.instanceId, true);
  try {
    await createActor(db, value.operator, "operator", runId);
    await createActor(db, value.readOnly, "read-only", runId);
    const auth = await authenticate(db, value.operator);
    for (const engine of ["archetype", "dimensions"] as const) {
      const prepared = await prepareP3cSource(
        `preview-${runId.slice(0, 8)}-${engine}`,
        engine,
        runId,
      );
      const ready = await seedReadyP2b3Source(db, auth, prepared);
      const applied = await createProductDraftService().applyReadyValidation(
        db.app,
        auth.credentials,
        ready.scope,
        ready.input,
      );
      const scope = {
        productId: prepared.productId,
        draftId: applied.application.draftId,
        revision: 1,
      };
      const blobs: PreviewFixture["sources"][number]["blobs"] = [];
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
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          }
          const resource = {
            resourceRef: {
              productId: scope.productId,
              id: "fixture-verification",
              version: "1.0.0",
            },
            sha256: blob.sha256,
            bytes: blob.bytes,
            mediaType: blob.mediaType,
            width: blob.width,
            height: blob.height,
          };
          await readPrivateResource(db.config, resource, () => {});
          blobs.push({ sha256: blob.sha256, bytes: blob.bytes, created });
        }
      } finally {
        await lock.close();
      }
      const fixed = await db.admin.sql.begin((tx) =>
        readFixedPreviewSource(tx, scope),
      );
      value.sources.push({
        scope,
        binding: fixed.binding,
        engine,
        sourceImportId: ready.scope.sourceImportId,
        sourceValidationId: ready.scope.sourceValidationId,
        canonicalContentSha256: fixed.binding.canonicalContentSha256,
        questionIds: fixed.content.questions.map((q) => q.id),
        witnesses: fixed.content.results.map((r) => ({
          resultId: r.id,
          answers: r.witness.answers.map((a) => ({
            questionId: a.questionRef.id,
            optionId: a.optionRef.id,
          })),
        })),
        blobs,
      });
      await save(db, value);
    }
    value.prepared = true;
    await save(db, value);
    return previewFixtureSchema.parse(value);
  } finally {
    await configureImports(db.config.instanceId, false);
  }
}
async function verifySources(db: TestDatabase, value: PreviewFixture) {
  for (const source of value.sources) {
    const fixed = await db.admin.sql.begin((tx) =>
      readFixedPreviewSource(tx, source.scope),
    );
    if (
      !same(fixed.binding, source.binding) ||
      fixed.content.engine.id !== source.engine
    )
      throw fail();
    const rows = await db.admin.sql<
      ValidationRow[]
    >`SELECT * FROM qf.quizpack_validation WHERE product_id=${source.scope.productId} LIMIT 2`;
    const row = rows[0];
    if (
      rows.length !== 1 ||
      !row ||
      row.id !== source.sourceValidationId ||
      row.import_id !== source.sourceImportId ||
      row.status !== "ready" ||
      row.storage_condition !== "clean" ||
      Number(row.reserved_bytes) !== 0 ||
      row.lease_until !== null
    )
      throw fail();
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
    const [counts] = await db.admin.sql<
      {
        drafts: number;
        revisions: number;
        applications: number;
        imports: number;
      }[]
    >`SELECT
      (SELECT count(*)::int FROM qf.product_draft WHERE product_id=${source.scope.productId}) drafts,
      (SELECT count(*)::int FROM qf.draft_revision WHERE product_id=${source.scope.productId} AND draft_id=${source.scope.draftId} AND revision=1 AND created_by=${value.operator.identifier}) revisions,
      (SELECT count(*)::int FROM qf.draft_application WHERE product_id=${source.scope.productId} AND created_by=${value.operator.identifier}) applications,
      (SELECT count(*)::int FROM qf.quizpack_import WHERE product_id=${source.scope.productId} AND id=${source.sourceImportId} AND created_by=${value.operator.identifier} AND status='received' AND reserved_bytes=0 AND attempts='[]'::jsonb) imports`;
    if (!counts || Object.values(counts).some((n) => n !== 1)) throw fail();
  }
}
export async function finishPreviewFixture(
  db: TestDatabase,
  runId: string,
): Promise<PreviewFixture> {
  const value = await readPreviewFixture(db, runId);
  await verifySources(db, value);
  const finished = { ...value, completed: true };
  await save(db, finished);
  return finished;
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
/** No CLI cleanup: proof is unforgeable within the actual server owner's process. */
export async function cleanupPreviewFixture(
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
  const value = await readPreviewFixture(db, runId);
  if (!value.completed || !ownerAbsent(value.writerPid)) throw fail();
  const live = await currentConfig(db.app);
  if (live.imports.enabled) throw fail();
  const verified = await createDatabase(live);
  await verified.close();
  await verifySources(db, value);
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
          lock.connection<{ pid: number }[]>`SELECT pg_backend_pid()::int pid`,
      );
      if (!storage) throw fail();
      const [other] = await db.admin.sql<
        { present: boolean }[]
      >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid() AND pid<>${storage.pid}) present`;
      if (other?.present) throw fail();
      return inspectPreviewNativeControl(value.qualification);
    };
    await check();
    const products = value.sources.map((s) => s.scope.productId),
      actors = [value.operator.identifier, value.readOnly.identifier];
    const [held] = await db.admin.sql<
      { present: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM qf.quizpack_validation WHERE reserved_bytes>0) OR EXISTS(SELECT 1 FROM qf.quizpack_import WHERE reserved_bytes>0) present`;
    if (held?.present) throw fail();
    const actorRows = await db.admin.sql<
      { id: string; label: string; credential_digest: string }[]
    >`SELECT id,label,credential_digest FROM qf.operator WHERE id=ANY(${db.admin.sql.array(actors)}::uuid[])`;
    if (
      actorRows.length !== 2 ||
      actorRows.some(
        (a) =>
          a.label !==
            `p3c-e2e-${runId}-${a.id === value.operator.identifier ? "operator" : "read-only"}` ||
          a.credential_digest !==
            digestToken(
              a.id === value.operator.identifier
                ? value.operator.secret
                : value.readOnly.secret,
              "credential",
            ),
      )
    )
      throw fail();
    const sessions = await db.admin.sql<
      { id: string }[]
    >`SELECT id FROM qf.operator_session WHERE operator_id=ANY(${db.admin.sql.array(actors)}::uuid[]) LIMIT 1025`;
    const audit = await db.admin.sql<
      FixtureAuditTarget[]
    >`SELECT id,action,actor_id,session_id,target_kind,target_id,target_revision FROM qf.audit_event WHERE actor_id=ANY(${db.admin.sql.array(actors)}::uuid[]) LIMIT 8193`;
    if (sessions.length > 1024 || audit.length > 8192) throw fail();
    for (const event of audit) {
      if (event.target_kind === "draft") {
        if (
          event.action !== "draft_applied" ||
          event.target_revision !== 1 ||
          event.actor_id !== value.operator.identifier ||
          !sessions.some((s) => s.id === event.session_id) ||
          !value.sources.some((s) => s.scope.draftId === event.target_id)
        )
          throw fail();
      } else if (
        !value.sources.some((source) =>
          fixtureAuditAllowed(event, {
            productId: source.scope.productId,
            importIds: new Set([source.sourceImportId]),
            validationIds: new Set([source.sourceValidationId]),
            actorIds: new Set(actors),
            sessionIds: new Set(sessions.map((s) => s.id)),
          }),
        )
      )
        throw fail();
    }
    const scan = await scanStorage(live, context),
      deletable: string[] = [],
      remove: ReturnType<typeof scannedFiles> = [];
    for (const source of value.sources) {
      await absent(importDirectory(live, source.sourceImportId));
      await absent(validationDirectory(live, source.sourceValidationId));
      for (const blob of source.blobs) {
        const [shared] = await db.admin.sql<
          { present: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM qf.product_asset WHERE product_id<>ALL(${db.admin.sql.array(products)}) AND blob_sha256=${blob.sha256}) OR EXISTS(SELECT 1 FROM qf.quizpack_validation v CROSS JOIN LATERAL jsonb_to_recordset((v.asset_set_text::jsonb)->'resources') r("blobSha256" text) WHERE v.product_id<>ALL(${db.admin.sql.array(products)}) AND r."blobSha256"=${blob.sha256}) present`;
        if (!shared) throw fail();
        if (shared.present) {
          if (blob.created) throw fail();
          continue;
        }
        if (!blob.created) throw fail();
        const facts = scannedFiles(scan, "blobs", blob.sha256);
        if (facts.length !== 1) throw fail();
        const fixed = await db.admin.sql.begin((tx) =>
          readFixedPreviewSource(tx, source.scope),
        );
        const r = fixed.content.resources.find((r) => r.sha256 === blob.sha256);
        if (!r || r.bytes !== blob.bytes) throw fail();
        await readPrivateResource(
          live,
          {
            resourceRef: {
              productId: r.productId,
              id: r.id,
              version: r.version,
            },
            sha256: r.sha256,
            bytes: r.bytes,
            mediaType: r.mediaType,
            width: r.width,
            height: r.height,
          },
          () => context.signal.throwIfAborted(),
        );
        if (!deletable.includes(blob.sha256)) {
          deletable.push(blob.sha256);
          remove.push(facts[0]!);
        }
      }
    }
    const nativeControl = await check();
    for (const fact of remove) await removeOwned(fact.file, fact.inode);
    await lock.check();
    await db.admin.sql.begin(async (tx) => {
      await acquireAuthWriteLock(tx);
      await tx`DELETE FROM qf.product_draft WHERE product_id=ANY(${tx.array(products)})`;
      await tx`DELETE FROM qf.draft_revision WHERE product_id=ANY(${tx.array(products)})`;
      await tx`DELETE FROM qf.draft_application WHERE product_id=ANY(${tx.array(products)})`;
      await tx`DELETE FROM qf.product_asset WHERE product_id=ANY(${tx.array(products)})`;
      await tx`DELETE FROM qf.quizpack_validation WHERE product_id=ANY(${tx.array(products)})`;
      await tx`DELETE FROM qf.quizpack_import WHERE product_id=ANY(${tx.array(products)}) AND created_by=${value.operator.identifier}`;
      await tx`DELETE FROM qf.product_tag WHERE product_id=ANY(${tx.array(products)})`;
      await tx`DELETE FROM qf.product WHERE id=ANY(${tx.array(products)})`;
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
      // Only the CLI suite bootstrap waits; direct PG fixtures retain their ordinary behavior.
      await absent(fixturePath(db));
      await waitForPreviewAuthBudget(db);
      await preparePreviewFixture(db, runId!);
    } else await finishPreviewFixture(db, runId!);
  } finally {
    await db.close();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  safeTestOperation(main).catch(() => {
    process.stderr.write("PREVIEW_FIXTURE_FAILED\n");
    process.exitCode = 1;
  });
