import { constants, type Stats } from "node:fs";
import { lstat, open, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  openTestDatabase,
  safeTestOperation,
  type TestDatabase,
} from "./p2a-fixture";
import { prepareP2b3Source, seedReadyP2b3Source } from "./p2b3-fixture";
import {
  studioDraftFixtureSchema,
  type StudioDraftFixture,
} from "./p2b3-studio-contract";
import { issueToken, digestToken } from "@/lib/security/p2a-tokens";
import { createPreauth, login } from "@/lib/auth/service";
import { acquireAuthWriteLock } from "@/lib/db/auth-lock";
import { archiveProduct } from "@/features/product/workspace/service";
import {
  instanceDirectory,
  importDirectory,
  validationDirectory,
  blobPath,
} from "@/features/quizpack/import/storage";
import { StorageLock } from "@/features/quizpack/import/storage-lock";
import {
  parseValidationAttempts,
  assetSetLedgerSchema,
  type ValidationRow,
} from "@/features/quizpack/validation/repository";
const privateName = "drafts-e2e-fixture.json";
function requireTestDatabase(db: TestDatabase) {
  if (!["test", "ci"].includes(db.config.purpose))
    throw new Error("DRAFTS_TEST_DATABASE_REQUIRED");
}
const fixturePath = (db: TestDatabase) =>
  path.join(instanceDirectory(db.config), privateName);
function privateFile(stat: Stats) {
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.uid !== process.getuid?.() ||
    stat.size > 16384
  )
    throw new Error("DRAFTS_FIXTURE_PRIVATE_FILE_REQUIRED");
}
export async function readStudioDraftFixture(db: TestDatabase, runId: string) {
  requireTestDatabase(db);
  z.uuid().parse(runId);
  const file = await open(
    fixturePath(db),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    privateFile(await file.stat());
    const buffer = Buffer.alloc(16385);
    let length = 0;
    while (length < buffer.length) {
      const part = await file.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (!part.bytesRead) break;
      length += part.bytesRead;
    }
    if (length > 16384) throw new Error();
    const bytes = buffer.subarray(0, length);
    const value = studioDraftFixtureSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    if (value.runId !== runId) throw new Error();
    return value;
  } finally {
    await file.close();
  }
}
async function save(db: TestDatabase, value: unknown, exclusive = false) {
  const file = await open(
    fixturePath(db),
    constants.O_WRONLY |
      constants.O_NOFOLLOW |
      (exclusive ? constants.O_CREAT | constants.O_EXCL : 0),
    0o600,
  );
  try {
    privateFile(await file.stat());
    const bytes = Buffer.from(JSON.stringify(value));
    if (bytes.length > 16384) throw new Error();
    await file.truncate(0);
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}
async function credentials(
  db: TestDatabase,
  actor: StudioDraftFixture["operator"],
) {
  const preauth = await createPreauth(db.app, null, randomUUID());
  const session = await login(
    db.app,
    preauth.raw,
    preauth.dto.csrfToken,
    actor.secret,
    randomUUID(),
  );
  return {
    sessionToken: session.raw,
    csrfToken: session.dto.csrfToken,
    requestId: randomUUID(),
  };
}
/** Synthetic DB-ready sources only. No actual receive/decoder/archive files or file-stop authority. */
export async function prepareStudioDraftFixture(
  db: TestDatabase,
  runId: string,
): Promise<StudioDraftFixture> {
  requireTestDatabase(db);
  z.uuid().parse(runId);
  const operator = issueToken("credential"),
    readOnly = issueToken("credential"),
    value = {
      version: 1 as const,
      runId,
      qualification: "synthetic-db-only-no-media" as const,
      completed: false,
      operator: { identifier: randomUUID(), secret: operator.raw },
      readOnly: { identifier: randomUUID(), secret: readOnly.raw },
      sources: [] as StudioDraftFixture["sources"],
    };
  await save(db, value, true);
  await db.admin.sql.begin(async (tx) => {
    await acquireAuthWriteLock(tx);
    await tx`INSERT INTO qf.operator(id,label,credential_digest,role,status) VALUES(${value.operator.identifier},${`b3-e2e-${runId}-operator`},${operator.digest},'operator','active'),(${value.readOnly.identifier},${`b3-e2e-${runId}-readonly`},${readOnly.digest},'read-only','active')`;
  });
  const auth = {
    id: value.operator.identifier,
    credentials: await credentials(db, value.operator),
  };
  for (let index = 0; index < 2; index++) {
    const productId = `e2e-drafts-${runId.slice(0, 8)}-${index}`,
      prepared = await prepareP2b3Source(productId, {
        largeContent: index === 0,
      }),
      source = await seedReadyP2b3Source(db, auth, prepared);
    value.sources.push({
      ...source.scope,
      stateRevision: source.row.state_revision,
      candidateSha256: source.input.expectedCandidateSha256,
      canonicalContentSha256: prepared.candidate.facts.canonicalContentSha256,
      canonicalContentBytes: Buffer.byteLength(
        prepared.candidate.facts.canonicalContentText,
      ),
    });
    await save(db, value);
  }
  return studioDraftFixtureSchema.parse(value);
}
async function verifySources(db: TestDatabase, value: StudioDraftFixture) {
  const rows = await db.admin.sql<
    ValidationRow[]
  >`SELECT * FROM qf.quizpack_validation WHERE product_id=ANY(${db.admin.sql.array(value.sources.map((s) => s.productId))}) ORDER BY id LIMIT 3`;
  if (rows.length !== 2) throw new Error("DRAFTS_FIXTURE_SCOPE_CHANGED");
  for (const source of value.sources) {
    const row = rows.find((r) => r.id === source.sourceValidationId);
    if (
      !row ||
      row.product_id !== source.productId ||
      row.import_id !== source.sourceImportId ||
      row.status !== "ready" ||
      row.state_revision !== source.stateRevision ||
      row.candidate_sha256 !== source.candidateSha256 ||
      row.storage_condition !== "clean" ||
      Number(row.reserved_bytes) !== 0 ||
      parseValidationAttempts(row.attempts_text).some(
        (a) =>
          a.ownerNonce !== "a".repeat(43) ||
          a.disposition !== "released" ||
          !a.fileStopProof ||
          a.mediaStop !== "confirmed",
      )
    )
      throw new Error("DRAFTS_FIXTURE_UNKNOWN_PRESERVED");
  }
  const imports = await db.admin.sql<
    {
      id: string;
      product_id: string;
      created_by: string;
      status: string;
      attempts: unknown[];
    }[]
  >`SELECT id,product_id,created_by,status,attempts FROM qf.quizpack_import WHERE product_id=ANY(${db.admin.sql.array(value.sources.map((s) => s.productId))}) LIMIT 3`;
  if (
    imports.length !== 2 ||
    imports.some(
      (row) =>
        row.created_by !== value.operator.identifier ||
        row.status !== "received" ||
        row.attempts.length !== 0 ||
        !value.sources.some(
          (source) =>
            source.productId === row.product_id &&
            source.sourceImportId === row.id,
        ),
    )
  )
    throw new Error("DRAFTS_FIXTURE_IMPORT_SCOPE_CHANGED");
  const assets = await db.admin.sql<
    {
      product_id: string;
      resource_id: string;
      resource_version: string;
      blob_sha256: string;
      declaration_sha256: string;
      source_validation_id: string;
    }[]
  >`SELECT product_id,resource_id,resource_version,blob_sha256,declaration_sha256,source_validation_id FROM qf.product_asset WHERE product_id=ANY(${db.admin.sql.array(value.sources.map((s) => s.productId))}) LIMIT 129`;
  const expected = rows.flatMap((row) =>
    assetSetLedgerSchema
      .parse(JSON.parse(row.asset_set_text!))
      .resources.map((resource) => ({
        ...resource,
        sourceValidationId: row.id,
      })),
  );
  if (
    assets.length !== expected.length ||
    assets.some(
      (asset) =>
        !expected.some(
          (resource) =>
            resource.productId === asset.product_id &&
            resource.resourceId === asset.resource_id &&
            resource.resourceVersion === asset.resource_version &&
            resource.blobSha256 === asset.blob_sha256 &&
            resource.declarationSha256 === asset.declaration_sha256 &&
            resource.sourceValidationId === asset.source_validation_id,
        ),
    )
  )
    throw new Error("DRAFTS_FIXTURE_ASSET_SCOPE_CHANGED");
  return rows;
}
async function verifyFinished(db: TestDatabase, value: StudioDraftFixture) {
  await verifySources(db, value);
  const [counts] = await db.admin.sql<
    {
      drafts: number;
      revisions: number;
      applications: number;
      audits: number;
    }[]
  >`SELECT (SELECT count(*)::int FROM qf.product_draft WHERE product_id=${value.sources[0]!.productId}) drafts,(SELECT count(*)::int FROM qf.draft_revision WHERE product_id=${value.sources[0]!.productId}) revisions,(SELECT count(*)::int FROM qf.draft_application WHERE product_id=${value.sources[0]!.productId}) applications,(SELECT count(*)::int FROM qf.audit_event WHERE action='draft_applied' AND actor_id=${value.operator.identifier}) audits`;
  if (!counts || Object.values(counts).some((n) => n !== 1))
    throw new Error("DRAFTS_FIXTURE_APPLICATION_NOT_CONFIRMED");
  const [other] = await db.admin.sql<
    { present: boolean }[]
  >`SELECT EXISTS(SELECT 1 FROM qf.product_draft WHERE product_id=${value.sources[1]!.productId}) AS present`;
  if (other?.present) throw new Error("DRAFTS_FIXTURE_FOREIGN_PRODUCT_CHANGED");
}
async function absent(file: string) {
  try {
    await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("DRAFTS_FIXTURE_ACTUAL_FILES_PRESERVED");
}
/** Root invokes only after owned Next exits. Unknown/incomplete fixtures are deliberately retained. */
export async function cleanupStudioDraftFixture(
  db: TestDatabase,
  value: StudioDraftFixture,
) {
  requireTestDatabase(db);
  const current = await readStudioDraftFixture(db, value.runId);
  if (
    JSON.stringify(current) !==
      JSON.stringify(studioDraftFixtureSchema.parse(value)) ||
    !value.completed
  )
    throw new Error("DRAFTS_FIXTURE_UNKNOWN_PRESERVED");
  const lock = await StorageLock.acquire(db.config);
  try {
    await verifyFinished(db, value);
    const [app] = await db.app.sql<
      { pid: number }[]
    >`SELECT pg_backend_pid() pid`;
    const [other] = await db.admin.sql<
      { present: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND pid<>${app!.pid}) AS present`;
    if (other?.present)
      throw new Error("DRAFTS_FIXTURE_SERVER_STILL_CONNECTED");
    for (const source of value.sources) {
      await absent(importDirectory(db.config, source.sourceImportId));
      await absent(validationDirectory(db.config, source.sourceValidationId));
    }
    const actors = [value.operator.identifier, value.readOnly.identifier],
      products = value.sources.map((s) => s.productId),
      targets = new Set([
        ...products,
        ...value.sources.map((s) => s.sourceValidationId),
      ]);
    const roots = await db.admin.sql<
      { id: string; product_id: string; created_by: string }[]
    >`SELECT id,product_id,created_by FROM qf.product_draft WHERE product_id=ANY(${db.admin.sql.array(products)})`;
    for (const root of roots) {
      if (root.created_by !== value.operator.identifier) throw new Error();
      targets.add(root.id);
    }
    const actorRows = await db.admin.sql<
      { id: string; label: string; credential_digest: string }[]
    >`SELECT id,label,credential_digest FROM qf.operator WHERE id=ANY(${db.admin.sql.array(actors)}::uuid[])`;
    if (
      actorRows.length !== 2 ||
      actorRows.some(
        (a) =>
          a.label !==
            `b3-e2e-${value.runId}-${a.id === value.operator.identifier ? "operator" : "readonly"}` ||
          a.credential_digest !==
            digestToken(
              a.id === value.operator.identifier
                ? value.operator.secret
                : value.readOnly.secret,
              "credential",
            ),
      )
    )
      throw new Error("DRAFTS_FIXTURE_ACTOR_CHANGED");
    const audit = await db.admin.sql<
      { id: string; target_id: string | null; target_kind: string | null }[]
    >`SELECT id,target_id,target_kind FROM qf.audit_event WHERE actor_id=ANY(${db.admin.sql.array(actors)}::uuid[]) LIMIT 257`;
    if (
      audit.length > 256 ||
      audit.some((a) => a.target_id !== null && !targets.has(a.target_id))
    )
      throw new Error("DRAFTS_FIXTURE_FOREIGN_AUDIT_PRESERVED");
    const assets = await db.admin.sql<
      { sha256: string }[]
    >`SELECT DISTINCT blob_sha256 sha256 FROM qf.product_asset WHERE product_id=ANY(${db.admin.sql.array(products)})`;
    const deletable: string[] = [];
    for (const asset of assets) {
      const [shared] = await db.admin.sql<
        { present: boolean }[]
      >`SELECT EXISTS(SELECT 1 FROM qf.product_asset WHERE product_id<>ALL(${db.admin.sql.array(products)}) AND blob_sha256=${asset.sha256}) OR EXISTS(SELECT 1 FROM qf.quizpack_validation v CROSS JOIN LATERAL jsonb_to_recordset((v.asset_set_text::jsonb)->'resources') AS r("blobSha256" text) WHERE v.product_id<>ALL(${db.admin.sql.array(products)}) AND r."blobSha256"=${asset.sha256}) AS present`;
      if (!shared?.present) {
        await absent(blobPath(db.config, asset.sha256));
        deletable.push(asset.sha256);
      }
    }
    await lock.check();
    await db.admin.sql.begin(async (tx) => {
      await acquireAuthWriteLock(tx);
      await tx`DELETE FROM qf.product_draft WHERE product_id=ANY(${tx.array(products)})`;
      await tx`DELETE FROM qf.draft_revision WHERE product_id=ANY(${tx.array(products)})`;
      await tx`DELETE FROM qf.draft_application WHERE product_id=ANY(${tx.array(products)})`;
      await tx`DELETE FROM qf.product_asset WHERE product_id=ANY(${tx.array(products)})`;
      await tx`DELETE FROM qf.quizpack_validation WHERE product_id=ANY(${tx.array(products)})`;
      await tx`DELETE FROM qf.quizpack_import WHERE product_id=ANY(${tx.array(products)}) AND created_by=${value.operator.identifier}`;
      await tx`DELETE FROM qf.product WHERE id=ANY(${tx.array(products)})`;
      if (deletable.length)
        await tx`DELETE FROM qf.asset_blob WHERE sha256=ANY(${tx.array(deletable)}) AND NOT EXISTS(SELECT 1 FROM qf.product_asset p WHERE p.blob_sha256=qf.asset_blob.sha256)`;
      await tx`DELETE FROM qf.audit_event WHERE id=ANY(${tx.array(audit.map((a) => a.id))}::uuid[]) AND actor_id=ANY(${tx.array(actors)}::uuid[])`;
      await tx`DELETE FROM qf.operator_session WHERE operator_id=ANY(${tx.array(actors)}::uuid[])`;
      await tx`DELETE FROM qf.operator WHERE id=ANY(${tx.array(actors)}::uuid[])`;
    });
    await unlink(fixturePath(db));
  } finally {
    await lock.close();
  }
}
async function main() {
  const [mode, runId] = process.argv.slice(2);
  z.uuid().parse(runId);
  if (!["prepare", "finish", "archive", "cleanup"].includes(mode ?? ""))
    throw new Error();
  const db = await openTestDatabase();
  try {
    if (mode === "prepare") await prepareStudioDraftFixture(db, runId!);
    else {
      const value = await readStudioDraftFixture(db, runId!);
      if (mode === "finish") {
        await verifyFinished(db, value);
        await save(db, { ...value, completed: true });
      } else if (mode === "archive") {
        await verifyFinished(db, value);
        const [product] = await db.admin.sql<
          { metadata_revision: number }[]
        >`SELECT metadata_revision FROM qf.product WHERE id=${value.sources[0]!.productId}`;
        await archiveProduct(
          db.app,
          await credentials(db, value.operator),
          value.sources[0]!.productId,
          { expectedMetadataRevision: product!.metadata_revision },
        );
      } else await cleanupStudioDraftFixture(db, value);
    }
    process.stdout.write("DRAFTS_FIXTURE_OK\n");
  } finally {
    await db.close();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  void safeTestOperation(main).catch(() => {
    process.stderr.write("DRAFTS_FIXTURE_FAILED\n");
    process.exitCode = 1;
  });
