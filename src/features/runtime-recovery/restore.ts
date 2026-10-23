import "server-only";
import { lstat, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import type postgres from "postgres";
import { createDatabase } from "@/lib/db/client";
import {
  initEmptyRecoveryInstance,
  loadManagedInstance,
  openManagedDatabase,
  writePrivateJson,
} from "@/lib/db/management";
import {
  readPostmaster,
  stopStartedPostgres,
  type StartedPostgres,
} from "@/lib/db/pg-start";
import { assertVerifiedRecoveryBundle } from "./artifact";
import { computeRecoveryCodeIdentity } from "./code-identity";
import {
  RECOVERY_TABLES,
  canonicalRecoveryJson,
  recoveryHash,
  recoveryOriginSchema,
  recoveryPortSchema,
} from "./contracts";
import type { RecoveryBudget, RestoreManagedRecoveryData } from "./ports";
import {
  assertRecoveryDirectory,
  checkRecoveryBudget,
  syncRecoveryDirectory,
} from "./files";
import {
  recoveryPgRunner,
  runRecoveryPg,
  assertRecoveryProcessesKnown,
} from "./database-process";
import {
  readRecoveryDatabaseEvidence,
  setRecoveryRowFormat,
} from "./database-evidence";
import { readRecoverySourceStorage } from "./source-storage";
import { normalizeRestoredRecoverySchema } from "./restore-schema";
import { assertRecoveryToc } from "./restore-toc";
import { RecoveryError } from "./errors";

export const restoreManagedRecoveryData: RestoreManagedRecoveryData = async (
  input,
) => {
  // Provenance authentication precedes even creating a target directory.
  assertVerifiedRecoveryBundle(input.bundle);
  checkRecoveryBudget(input);
  const manifest = input.bundle.manifest,
    source = manifest.source;
  recoveryPortSchema.parse(input.pgPort);
  recoveryOriginSchema.parse(input.origin);
  const root = process.cwd();
  if (
    root === source.root ||
    root.startsWith(source.root + "/") ||
    source.root.startsWith(root + "/") ||
    input.pgPort === source.pgPort ||
    input.origin === source.origin
  )
    throw new RecoveryError("RECOVERY_DESTINATION_EXISTS");
  if (
    input.codeSha256 !== source.codeSha256 ||
    (await computeRecoveryCodeIdentity(process.cwd(), input)).codeSha256 !==
      input.codeSha256
  )
    throw new RecoveryError("RECOVERY_CODE_MISMATCH");
  await input.bundle.assertValid();
  if (
    !(await runRecoveryPg("pg_restore", ["--version"], input)).includes(
      " 18.4 ",
    )
  )
    throw new RecoveryError("RECOVERY_ENVIRONMENT_UNSUPPORTED");
  const targetDirectory = path.join(
    process.cwd(),
    ".cache",
    "p2a",
    source.instanceId,
  );
  try {
    await lstat(targetDirectory);
    throw new RecoveryError("RECOVERY_DESTINATION_EXISTS");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await input.bundle.withDump(async (file) => {
    assertVerifiedRecoveryBundle(input.bundle);
    assertRecoveryToc(
      await runRecoveryPg("pg_restore", ["--list"], input, { input: file }),
      source.instanceId,
    );
  });
  const origin = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    origin.once("error", () =>
      reject(new RecoveryError("RECOVERY_DESTINATION_EXISTS")),
    );
    origin.listen(
      {
        host: "127.0.0.1",
        port: Number(new URL(input.origin).port),
        exclusive: true,
      },
      resolve,
    );
  });
  let target: Awaited<ReturnType<typeof initEmptyRecoveryInstance>> | undefined;
  let started: StartedPostgres | undefined;
  let db: Awaited<ReturnType<typeof openManagedDatabase>> | undefined;
  let connection: postgres.ReservedSql | undefined;
  let stopped = false,
    verified = false,
    closeFailed = false;
  let graph = "",
    storageHash = "";
  const cleanupBudget = (): RecoveryBudget => ({
    deadlineMonotonicMs: performance.now() + 15000,
    signal: new AbortController().signal,
  });
  try {
    target = await initEmptyRecoveryInstance(
      {
        instanceId: source.instanceId,
        purpose: source.purpose,
        port: input.pgPort,
        origin: input.origin,
      },
      recoveryPgRunner(input),
    );
    started = await readPostmaster({
      instanceId: target.instanceId,
      pgdata: target.pgdata!,
      socket: target.socket!,
      port: target.port,
    });
    const managed = await loadManagedInstance(source.instanceId);
    db = await openManagedDatabase(source.instanceId);
    const [empty] = await db.sql<
      { n: number }[]
    >`SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('qf','qf_meta')`;
    if (empty?.n !== 0) throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
    await input.bundle.withDump(async (file) => {
      assertVerifiedRecoveryBundle(input.bundle);
      await runRecoveryPg(
        "pg_restore",
        [
          "--host=127.0.0.1",
          `--port=${input.pgPort}`,
          `--username=${managed.admin.owner.user}`,
          `--dbname=${managed.admin.owner.name}`,
          "--no-password",
          "--single-transaction",
          "--exit-on-error",
        ],
        input,
        { input: file, env: { PGPASSWORD: managed.admin.owner.password } },
      );
    });
    await normalizeRestoredRecoverySchema(db.sql, input);
    await input.bundle.installStorage(targetDirectory);
    await input.bundle.assertValid();
    const app = await createDatabase(managed.config);
    try {
      checkRecoveryBudget(input);
    } finally {
      await app.close();
    }
    connection = await db.sql.reserve();
    await connection.unsafe("SET statement_timeout='2s'");
    await connection.unsafe("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await connection.unsafe(
      `LOCK TABLE ${RECOVERY_TABLES.join(",")} IN SHARE MODE NOWAIT`,
    );
    await setRecoveryRowFormat(connection);
    const database = await readRecoveryDatabaseEvidence(connection, input);
    if (
      canonicalRecoveryJson(database) !==
      canonicalRecoveryJson(manifest.database)
    )
      throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
    const files = await readRecoverySourceStorage(
      managed.config,
      connection,
      input,
      true,
    );
    if (
      canonicalRecoveryJson(files) !== canonicalRecoveryJson(manifest.storage)
    )
      throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
    graph = database.graphSha256;
    storageHash = recoveryHash(canonicalRecoveryJson(files));
    if (
      (await computeRecoveryCodeIdentity(process.cwd(), input)).codeSha256 !==
      input.codeSha256
    )
      throw new RecoveryError("RECOVERY_CODE_MISMATCH");
    graph = database.graphSha256;
    verified = true;
  } finally {
    if (connection) {
      try {
        await connection.unsafe("ROLLBACK");
      } catch {
        closeFailed = true;
      } finally {
        connection.release();
      }
    }
    if (db) {
      try {
        await db.close();
      } catch {
        closeFailed = true;
      }
    }
    if (started) {
      try {
        stopped = await stopStartedPostgres(
          started,
          recoveryPgRunner(cleanupBudget()),
        );
        if (!stopped) closeFailed = true;
      } catch {
        closeFailed = true;
      }
    }
    await new Promise<void>((resolve, reject) =>
      origin.close((error) => (error ? reject(error) : resolve())),
    );
    assertRecoveryProcessesKnown();
    if (closeFailed) throw new RecoveryError("RECOVERY_CLOSE_UNPROVEN");
  }
  if (!verified || !stopped || !target)
    throw new RecoveryError("RECOVERY_RESTORE_FAILED_PRESERVED");
  checkRecoveryBudget(input);
  await assertRecoveryDirectory(targetDirectory, input);
  await writePrivateJson(path.join(targetDirectory, "recovery-verified.json"), {
    schemaVersion: "quizforge.recovery-target.v1",
    instanceId: source.instanceId,
    manifestSha256: input.bundle.manifestSha256,
    databaseGraphSha256: graph,
    storageSha256: storageHash,
    status: "verified-stopped",
  });
  await syncRecoveryDirectory(targetDirectory, input);
  // Last issued IO: any earlier failure retains pending and prevents normal start/backup.
  await unlink(path.join(targetDirectory, "recovery-pending.json"));
  return {
    instanceId: source.instanceId,
    root: process.cwd(),
    pgPort: input.pgPort,
    origin: input.origin,
    manifestSha256: input.bundle.manifestSha256,
    databaseGraphSha256: graph,
    storageSha256: storageHash,
    status: "verified-stopped",
  };
};
