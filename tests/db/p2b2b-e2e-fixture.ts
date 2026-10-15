import { constants } from "node:fs";
import { open, lstat, opendir, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  openTestDatabase,
  safeTestOperation,
  type TestDatabase,
} from "./p2a-fixture";
import { createDatabase } from "@/lib/db/client";
import { instancePaths } from "@/lib/db/management";
import { createProduct } from "@/features/product/workspace/service";
import { issueToken } from "@/lib/security/p2a-tokens";
import { createPreauth, login } from "@/lib/auth/service";
import { acquireAuthWriteLock } from "@/lib/db/auth-lock";
import { readPrivateJson } from "@/lib/db/runtime";
import { importReceiveService } from "@/features/quizpack/import/service";
import { createReceiveContext } from "@/features/quizpack/import/context";
import { createStoredArchive } from "@/features/quizpack/v1/build";
import { createSyntheticFixture } from "@/features/quizpack/v1/fixtures/synthetic";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import {
  createValidationContext,
  ArchiveOperation,
} from "@/features/quizpack/validation/operation";
import {
  parseValidationAttempts,
  assetSetLedgerSchema,
  type ValidationRow,
} from "@/features/quizpack/validation/repository";
import { validationKeySchema } from "@/features/quizpack/validation/contracts";
import { readValidationStopped } from "@/features/quizpack/validation/receipt";
import { StorageLock } from "@/features/quizpack/import/storage-lock";
import {
  instanceDirectory,
  importDirectory,
  validationDirectory,
  scanStorage,
  scannedFiles,
  stopped,
  removeOwned,
  privateDirectory,
  privateFile,
  type FileFact,
} from "@/features/quizpack/import/storage";
import type { ImportRow } from "@/features/quizpack/import/repository";
import {
  fixtureMaintenanceOperation,
  fixtureAuditAllowed,
  fixtureValidationOwnersEnded,
  type FixtureAuditTarget,
} from "./p2b2b-maintenance";
import { p2b2bFixtureSchema, ownerAbsent } from "./p2b2b-fixture-contract";

const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const privateName = "validations-e2e-fixture.json";
export type ValidationFixture = z.infer<typeof p2b2bFixtureSchema>;
type Fixture = ValidationFixture;
export async function readTestValidationFixture(
  database: TestDatabase,
  runId: string,
): Promise<Fixture> {
  const file = path.join(instanceDirectory(database.config), privateName),
    stat = await lstat(file);
  privateFile(stat);
  if (stat.nlink !== 1 || stat.size > 8192) throw new Error();
  const value = p2b2bFixtureSchema.parse(await readPrivateJson(file));
  if (value.runId !== runId) throw new Error();
  return value;
}
/** Receive runs in its own process: its exit, never a validation marker, proves receive ownership ended. */
export async function prepareTestValidationFixture(
  database: TestDatabase,
  runId: string,
): Promise<ValidationFixture> {
  z.uuid().parse(runId);
  if (!["test", "ci"].includes(database.config.purpose))
    throw new Error("TEST_VALIDATION_INSTANCE_REQUIRED");
  await promisify(execFile)(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      fileURLToPath(import.meta.url),
      "prepare",
      runId,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        QUIZFORGE_P2A_CONFIG: instancePaths(database.config.instanceId).runtime,
      },
      timeout: 60_000,
      maxBuffer: 4096,
    },
  );
  return readTestValidationFixture(database, runId);
}
function remap(value: unknown, productId: string): unknown {
  if (Array.isArray(value)) return value.map((v) => remap(v, productId));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        key === "productId" ? productId : remap(v, productId),
      ]),
    );
  return value;
}
async function configureEnabled(database: TestDatabase, enabled: boolean) {
  await promisify(execFile)(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "scripts/p2a-db.ts",
      "imports",
      "--instance",
      database.config.instanceId,
      "--enabled",
      enabled ? "true" : "false",
    ],
    { cwd: process.cwd(), env: process.env, timeout: 30000, maxBuffer: 4096 },
  );
}
async function prepare(database: TestDatabase, runId: string) {
  const file = path.join(instanceDirectory(database.config), privateName),
    handle = await open(
      file,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
  // A failed preparation leaves its private record and rows for explicit maintenance.
  const operator = issueToken("credential"),
    readOnly = issueToken("credential"),
    operatorId = randomUUID(),
    readOnlyId = randomUUID(),
    productId = `e2e-validations-${runId.slice(0, 8)}`;
  const value = {
    version: 1 as const,
    runId,
    operator: { identifier: operatorId, secret: operator.raw },
    readOnly: { identifier: readOnlyId, secret: readOnly.raw },
    productId,
    imports: [] as Fixture["imports"],
  };
  let enabledConfirmed = false;
  const save = async () => {
    await handle.truncate(0);
    const bytes = Buffer.from(JSON.stringify(value));
    let position = 0;
    while (position < bytes.length) {
      const written = await handle.write(
        bytes,
        position,
        bytes.length - position,
        position,
      );
      if (!written.bytesWritten) throw new Error();
      position += written.bytesWritten;
    }
    await handle.sync();
  };
  try {
    await save();
    await configureEnabled(database, true);
    enabledConfirmed = true;
    await database.admin.sql.begin(async (tx) => {
      await acquireAuthWriteLock(tx);
      await tx`INSERT INTO qf.operator(id,label,credential_digest,role,status) VALUES(${operatorId},'validations-e2e-operator',${operator.digest},'operator','active'),(${readOnlyId},'validations-e2e-read-only',${readOnly.digest},'read-only','active')`;
    });
    const preauth = await createPreauth(database.app, null, randomUUID()),
      session = await login(
        database.app,
        preauth.raw,
        preauth.dto.csrfToken,
        operator.raw,
        randomUUID(),
      ),
      credentials = {
        sessionToken: session.raw,
        csrfToken: session.dto.csrfToken,
        requestId: randomUUID(),
      };
    await createProduct(database.app, credentials, {
      id: productId,
      slug: productId,
      title: "合成验证归档工作区",
      primaryCategoryId: null,
      tagIds: [],
    });
    const source = await createSyntheticFixture("dimensions"),
      content = remap(source.content, productId),
      contentBytes = Buffer.from(canonicalP1Json(content)),
      manifest = {
        ...source.manifest,
        productId,
        packId: `e2e-${runId.slice(0, 8)}`,
        files: source.manifest.files.map((f) =>
          f.path === "content.json"
            ? { ...f, bytes: contentBytes.length, sha256: sha(contentBytes) }
            : f,
        ),
      };
    const bytes = await createStoredArchive(
        [
          {
            path: "manifest.json",
            bytes: Buffer.from(canonicalP1Json(manifest)),
          },
          { path: "content.json", bytes: contentBytes },
          ...source.assets,
        ],
        33_554_432,
        new AbortController().signal,
      ),
      archiveSha256 = sha(bytes);
    for (let i = 0; i < 3; i++) {
      const intent = await importReceiveService.createIntent(
        database.app,
        { ...credentials, requestId: randomUUID() },
        productId,
        randomUUID(),
        {
          expectedArchiveBytes: bytes.length,
          expectedArchiveSha256: archiveSha256,
          target: { kind: "new-draft" },
        },
      );
      const { context, dispose } = createReceiveContext(
        new AbortController().signal,
      );
      const requestDb = await createDatabase(database.config, {
        signal: context.signal,
        deadlineMonotonicMs: context.deadlineMonotonicMs,
      });
      try {
        const received = await importReceiveService.receiveArchive(
          requestDb,
          { ...credentials, requestId: randomUUID() },
          productId,
          intent.import.id,
          {
            chunks: {
              async *[Symbol.asyncIterator]() {
                yield bytes;
              },
            },
            cancel: async () => {},
          },
          context,
        );
        if (
          received.status !== "received" ||
          received.actualArchiveSha256 !== archiveSha256 ||
          received.actualArchiveBytes !== bytes.length
        )
          throw new Error();
        value.imports.push({
          importId: intent.import.id,
          expectedImportStateRevision: received.stateRevision,
          archiveSha256,
          archiveBytes: bytes.length,
        });
        await save();
      } finally {
        await requestDb.close();
        dispose();
      }
    }
    p2b2bFixtureSchema.parse(value);
  } finally {
    try {
      if (enabledConfirmed) await configureEnabled(database, false);
    } finally {
      await handle.close();
    }
  }
}
async function noOtherBackends(
  database: TestDatabase,
  lock: StorageLock,
  op: ArchiveOperation,
) {
  const [admin] = await op.databaseAwait(
    "read",
    () =>
      database.admin.sql<{ pid: number }[]>`SELECT pg_backend_pid()::int pid`,
  );
  const [storage] = await op.fileTask(() =>
    lock.query(
      () =>
        lock.connection<{ pid: number }[]>`SELECT pg_backend_pid()::int pid`,
    ),
  );
  if (!admin || !storage) throw new Error();
  const rows = await op.databaseAwait(
    "read",
    () =>
      database.admin.sql<
        { pid: number }[]
      >`SELECT pid::int FROM pg_stat_activity WHERE datname=${database.config.database.name} AND backend_type='client backend' AND pid<>${admin.pid} AND pid<>${storage.pid} LIMIT 1`,
  );
  if (rows.length) throw new Error();
}
async function runtimeControlEmpty(op: ArchiveOperation) {
  const role =
    process.platform === "darwin" && process.arch === "arm64"
      ? "darwin-arm64"
      : process.platform === "linux" && process.arch === "x64"
        ? "linux-x64"
        : null;
  if (!role) throw new Error();
  const directory = path.join(
    process.cwd(),
    ".cache",
    "quizpack-media-runtime",
    role,
    "control",
  );
  await op.fileTask(async () => {
    await privateDirectory(directory, () => op.nonDbCheckpoint());
    const before = await lstat(directory);
    op.nonDbCheckpoint();
    const entries = await opendir(directory, { bufferSize: 16 });
    try {
      if (await entries.read()) throw new Error();
      op.nonDbCheckpoint();
    } finally {
      await entries.close();
    }
    const after = await lstat(directory);
    op.nonDbCheckpoint();
    if (before.dev !== after.dev || before.ino !== after.ino) throw new Error();
  });
}
async function verifyFile(
  op: ArchiveOperation,
  fact: FileFact,
  bytes: number,
  expectedSha: string,
) {
  await op.fileTask(async () => {
    const before = await lstat(fact.file);
    op.nonDbCheckpoint();
    privateFile(before);
    if (
      before.ino !== fact.inode.ino ||
      before.dev !== fact.inode.dev ||
      before.size !== bytes ||
      bytes > 33_554_432
    )
      throw new Error();
    const handle = await open(
      fact.file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    let total = 0;
    const digest = createHash("sha256"),
      buffer = Buffer.alloc(Math.min(bytes + 1, 65536));
    try {
      const opened = await handle.stat();
      op.nonDbCheckpoint();
      if (
        opened.dev !== before.dev ||
        opened.ino !== before.ino ||
        opened.size !== before.size
      )
        throw new Error();
      for (;;) {
        op.nonDbCheckpoint();
        const read = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, bytes + 1 - total),
          total,
        );
        op.nonDbCheckpoint();
        if (!read.bytesRead) break;
        total += read.bytesRead;
        if (total > bytes) throw new Error();
        digest.update(buffer.subarray(0, read.bytesRead));
      }
      const after = await handle.stat(),
        current = await lstat(fact.file);
      op.nonDbCheckpoint();
      privateFile(current);
      if (
        total !== bytes ||
        digest.digest("hex") !== expectedSha ||
        after.ino !== before.ino ||
        after.dev !== before.dev ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        current.ino !== before.ino ||
        current.dev !== before.dev ||
        current.size !== before.size ||
        current.mtimeMs !== before.mtimeMs
      )
        throw new Error();
    } finally {
      await handle.close();
    }
    op.nonDbCheckpoint();
  });
}
async function cleanup(
  database: TestDatabase,
  value: Fixture,
  mode: "cross-process" | "same-process" = "cross-process",
) {
  if (database.config.imports.enabled) throw new Error();
  await database.app.close(); // All subsequent DB work is the helper's owner connection and storage connection.
  const { context, dispose } = createValidationContext(
      new AbortController().signal,
    ),
    op = fixtureMaintenanceOperation(database, context),
    lock = await op.fileTask(() =>
      StorageLock.acquire(database.config, context),
    );
  op.attachLock(lock);
  try {
    await noOtherBackends(database, lock, op);
    const imports = await op.databaseAwait(
      "read",
      () =>
        database.admin.sql<
          ImportRow[]
        >`SELECT * FROM qf.quizpack_import WHERE product_id=${value.productId} ORDER BY id LIMIT 4`,
    );
    if (
      imports.length !== 3 ||
      imports.some(
        (row) =>
          !value.imports.some(
            (i) =>
              i.importId === row.id &&
              i.archiveSha256 === row.actual_archive_sha256 &&
              i.archiveBytes === row.actual_archive_bytes &&
              i.expectedImportStateRevision === row.state_revision,
          ),
      )
    )
      throw new Error();
    const validations = await op.databaseAwait(
      "read",
      () =>
        database.admin.sql<
          ValidationRow[]
        >`SELECT * FROM qf.quizpack_validation WHERE product_id=${value.productId} ORDER BY id LIMIT 4`,
    );
    if (
      validations.length > 3 ||
      validations.some(
        (row) =>
          !value.imports.some(
            (i) =>
              i.importId === row.import_id &&
              i.archiveSha256 === row.archive_sha256 &&
              i.archiveBytes === row.archive_bytes,
          ),
      )
    )
      throw new Error();
    const actors = [value.operator.identifier, value.readOnly.identifier];
    const sessions = await op.databaseAwait(
      "read",
      () =>
        database.admin.sql<
          { id: string }[]
        >`SELECT id FROM qf.operator_session WHERE operator_id=ANY(${database.admin.sql.array(actors)}::uuid[]) ORDER BY id LIMIT 1025`,
    );
    const audit = await op.databaseAwait(
      "read",
      () =>
        database.admin.sql<
          FixtureAuditTarget[]
        >`SELECT id,action,actor_id,session_id,target_kind,target_id,target_revision FROM qf.audit_event WHERE actor_id=ANY(${database.admin.sql.array(actors)}::uuid[]) ORDER BY id LIMIT 8193`,
    );
    const auditScope = {
      productId: value.productId,
      importIds: new Set(value.imports.map((i) => i.importId)),
      validationIds: new Set(validations.map((v) => v.id)),
      actorIds: new Set(actors),
      sessionIds: new Set(sessions.map((s) => s.id)),
    };
    if (
      sessions.length > 1024 ||
      audit.length > 8192 ||
      audit.some((event) => !fixtureAuditAllowed(event, auditScope))
    )
      throw new Error();
    const outsideHeld = await op.databaseAwait(
      "read",
      () =>
        database.admin.sql<
          { present: boolean }[]
        >`SELECT true present FROM qf.quizpack_validation WHERE product_id<>${value.productId} AND reserved_bytes>0 UNION ALL SELECT true present FROM qf.quizpack_import WHERE product_id<>${value.productId} AND reserved_bytes>0 LIMIT 1`,
    );
    if (outsideHeld.length) throw new Error();
    const scan = await op.fileTask(() => scanStorage(database.config, context)),
      remove: FileFact[] = [],
      directories: string[] = [],
      blobHashes = new Set<string>();
    for (const row of imports) {
      if (
        row.status !== "received" ||
        row.attempts.some(
          (a) => a.disposition !== "released" || !ownerAbsent(a.ownerPid),
        )
      )
        throw new Error();
      for (const a of row.attempts)
        if (!(await op.fileTask(() => stopped(database.config, row.id, a))))
          throw new Error();
      const files = scannedFiles(scan, "imports", row.id);
      if (!files.some((f) => path.basename(f.file) === "archive.quizpack"))
        throw new Error();
      for (const f of files) {
        const name = path.basename(f.file);
        if (name === "archive.quizpack")
          await verifyFile(
            op,
            f,
            row.actual_archive_bytes!,
            row.actual_archive_sha256!,
          );
        else if (
          !row.attempts.some(
            (a) =>
              name === `stopped-${a.attemptId}.json` ||
              name === `stopped-${a.attemptId}.json.tmp-${a.attemptId}`,
          )
        )
          throw new Error();
        remove.push(f);
      }
      directories.push(importDirectory(database.config, row.id));
    }
    for (const row of validations) {
      const attempts = parseValidationAttempts(row.attempts_text);
      if (
        !fixtureValidationOwnersEnded(database, row, mode) ||
        attempts.some((a) => !a.fileStopProof || a.mediaStop === "unconfirmed")
      )
        throw new Error();
      for (const a of attempts)
        if (!(await readValidationStopped(op, database.config, row.id, a)))
          throw new Error();
      for (const f of scannedFiles(scan, "validation", row.id)) {
        const name = path.basename(f.file);
        if (
          !attempts.some(
            (a) =>
              name === `stopped-${a.attemptId}.json` ||
              name === `stopped-${a.attemptId}.json.tmp-${a.attemptId}` ||
              name === `attempt-${a.attemptId}.partial`,
          )
        )
          throw new Error();
        remove.push(f);
      }
      if (scan.files.has(`validation:${row.id}`))
        directories.push(validationDirectory(database.config, row.id));
      if (row.asset_set_text !== null)
        for (const r of assetSetLedgerSchema.parse(
          JSON.parse(row.asset_set_text),
        ).resources)
          blobHashes.add(r.blobSha256);
    }
    const blobs = await op.databaseAwait(
      "read",
      () =>
        database.admin.sql<
          { sha256: string; bytes: number }[]
        >`SELECT sha256,bytes FROM qf.asset_blob WHERE sha256=ANY(${database.admin.sql.array([...blobHashes])}) LIMIT 193`,
    );
    if (blobs.length > 192) throw new Error();
    // Shared blobs remain in place. No scoped fixture can destroy another Product's assets or reservation.
    const foreign = await op.databaseAwait(
      "read",
      () =>
        database.admin.sql<
          { sha256: string }[]
        >`SELECT DISTINCT blob_sha256 sha256 FROM qf.product_asset WHERE product_id<>${value.productId} AND blob_sha256=ANY(${database.admin.sql.array([...blobHashes])}) LIMIT 193`,
    );
    const outsidePlans = await op.databaseAwait(
      "read",
      () =>
        database.admin.sql<
          { sha256: string }[]
        >`SELECT DISTINCT r."blobSha256" sha256 FROM qf.quizpack_validation v CROSS JOIN LATERAL jsonb_to_recordset((v.asset_set_text::jsonb)->'resources') AS r("blobSha256" text) WHERE v.product_id<>${value.productId} AND r."blobSha256"=ANY(${database.admin.sql.array([...blobHashes])}) LIMIT 193`,
    );
    const shared = new Set([...foreign, ...outsidePlans].map((b) => b.sha256));
    for (const hash of blobHashes) {
      if (shared.has(hash)) continue;
      const facts = scannedFiles(scan, "blobs", hash);
      if (facts.length !== 1) throw new Error();
      const blob = blobs.find((b) => b.sha256 === hash);
      if (!blob) throw new Error();
      await verifyFile(op, facts[0]!, Number(blob.bytes), hash);
      remove.push(facts[0]!);
    }
    await runtimeControlEmpty(op);
    await noOtherBackends(database, lock, op);
    if (
      validations.some(
        (row) => !fixtureValidationOwnersEnded(database, row, mode),
      )
    )
      throw new Error();
    // Root invokes this only after the managed server has exited, under exclusive synthetic maintenance.
    for (const f of remove)
      await op.fileTask(() => removeOwned(f.file, f.inode));
    for (const dir of directories) await op.fileTask(() => rmdir(dir));
    await lock.check();
    await op.databaseAwait("write", () =>
      database.admin.sql.begin(async (tx) => {
        await acquireAuthWriteLock(tx);
        await tx`DELETE FROM qf.product_asset WHERE product_id=${value.productId}`;
        await tx`DELETE FROM qf.quizpack_validation WHERE product_id=${value.productId} AND identity_kind<>'canonical'`;
        await tx`DELETE FROM qf.quizpack_validation WHERE product_id=${value.productId}`;
        await tx`DELETE FROM qf.quizpack_import WHERE product_id=${value.productId}`;
        await tx`DELETE FROM qf.product_tag WHERE product_id=${value.productId}`;
        await tx`DELETE FROM qf.product WHERE id=${value.productId}`;
        await tx`DELETE FROM qf.asset_blob WHERE sha256=ANY(${tx.array([...blobHashes].filter((h) => !shared.has(h)))}) AND NOT EXISTS(SELECT 1 FROM qf.product_asset p WHERE p.blob_sha256=qf.asset_blob.sha256)`;
        await tx`DELETE FROM qf.audit_event WHERE id=ANY(${tx.array(audit.map((a) => a.id))}::uuid[]) AND actor_id=ANY(${tx.array(actors)}::uuid[])`;
        await tx`DELETE FROM qf.operator_session WHERE id=ANY(${tx.array(sessions.map((s) => s.id))}::uuid[]) AND operator_id=ANY(${tx.array(actors)}::uuid[])`;
        await tx`DELETE FROM qf.operator WHERE id=ANY(${tx.array([value.operator.identifier, value.readOnly.identifier])}::uuid[])`;
      }),
    );
    await op.fileTask(() =>
      unlink(path.join(instanceDirectory(database.config), privateName)),
    );
  } finally {
    await op.closeStorageLock();
    await op.settle();
    dispose();
  }
}
/** Only this in-process entry may consult the original request observer; no proof is accepted from a caller. */
export async function cleanupTestValidationFixture(
  database: TestDatabase,
  value: ValidationFixture,
) {
  if (!["test", "ci"].includes(database.config.purpose))
    throw new Error("TEST_VALIDATION_INSTANCE_REQUIRED");
  const stored = await readTestValidationFixture(database, value.runId);
  if (canonicalP1Json(stored) !== canonicalP1Json(value))
    throw new Error("TEST_VALIDATION_FIXTURE_MISMATCH");
  await cleanup(database, stored, "same-process");
}
async function run() {
  const mode = z
      .enum(["prepare", "cleanup", "enable", "disable", "observe-validation"])
      .parse(process.argv[2]),
    runId = z.uuid().parse(process.argv[3]),
    database = await openTestDatabase();
  try {
    if (mode === "prepare") return await prepare(database, runId);
    const stored = await readTestValidationFixture(database, runId);
    if (mode === "cleanup") return await cleanup(database, stored);
    if (mode === "enable" || mode === "disable") {
      await configureEnabled(database, mode === "enable");
      return;
    }
    const key = validationKeySchema.parse(process.argv[4]),
      rows = await database.admin.sql<
        { status: string; state_revision: number; attempts_text: string }[]
      >`SELECT status,state_revision,attempts_text FROM qf.quizpack_validation WHERE product_id=${stored.productId} AND import_id=ANY(${database.admin.sql.array(stored.imports.map((i) => i.importId))}::uuid[]) AND validation_key=${key} LIMIT 2`;
    if (rows.length !== 1) throw new Error();
    const row = rows[0]!;
    if (
      ![
        "ready",
        "rejected",
        "retryable-failed",
        "validated",
        "archiving",
        "validating",
      ].includes(row.status)
    )
      throw new Error();
    process.stdout.write(
      JSON.stringify({
        recordObserved: true,
        state: row.status,
        revision: row.state_revision,
        acknowledged: parseValidationAttempts(row.attempts_text).every((a) =>
          Boolean(a.fileStopProof),
        ),
      }) + "\n",
    );
  } finally {
    await database.close();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  safeTestOperation(run)
    .then(() => {
      process.stdout.write("VALIDATIONS_E2E_FIXTURE_READY\n");
    })
    .catch(() => {
      process.stderr.write("VALIDATIONS_E2E_FIXTURE_FAILED\n");
      process.exitCode = 1;
    });
