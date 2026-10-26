import { rmdir } from "node:fs/promises";
import path from "node:path";
import type postgres from "postgres";
import { StorageLock } from "../../src/features/quizpack/import/storage-lock";
import {
  scanStorage,
  stopped,
  removeOwned,
  importDirectory,
} from "../../src/features/quizpack/import/storage";
import { createReceiveContext } from "../../src/features/quizpack/import/context";
import type { ImportRow } from "../../src/features/quizpack/import/repository";
import { createDatabase } from "../../src/lib/db/client";
import { loadRuntimeConfig } from "../../src/lib/db/runtime";
import { openManagedDatabase } from "../../src/lib/db/management";

// No implicit instance creation, no demo cleanup, no skip or in-memory fallback.
export async function openTestDatabase() {
  const config = await loadRuntimeConfig();
  if (config.purpose !== "test" && config.purpose !== "ci")
    throw new Error("P2A_TEST_DATABASE_REQUIRED");
  const admin = await openManagedDatabase(config.instanceId);
  try {
    if (JSON.stringify(admin.config) !== JSON.stringify(config))
      throw new Error("P2A_TEST_DATABASE_IDENTITY_MISMATCH");
    const app = await createDatabase(config);
    return {
      config,
      app,
      admin,
      close: async () => {
        await app.close();
        await admin.close();
      },
    };
  } catch (error) {
    await admin.close();
    throw error;
  }
}
export type TestDatabase = Awaited<ReturnType<typeof openTestDatabase>>;

/** Business fixtures never own account operations or password links. Refuse occupied account scope. */
export async function withEmptyAccountFixtureScope(
  db: TestDatabase,
  work: (tx: postgres.TransactionSql) => Promise<void>,
): Promise<void> {
  if (db.config.purpose !== "test" && db.config.purpose !== "ci")
    throw new Error("P2A_TEST_DATABASE_REQUIRED");
  await db.admin.sql.begin(async (tx) => {
    await tx`LOCK TABLE qf.operator_password_token,qf.operator_account_operation,qf.operator_kdf_attempt IN ACCESS EXCLUSIVE MODE NOWAIT`;
    const [rows] = await tx<{ occupied: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM qf.operator_password_token)
          OR EXISTS(SELECT 1 FROM qf.operator_account_operation)
          OR EXISTS(SELECT 1 FROM qf.operator_kdf_attempt) occupied`;
    if (rows?.occupied !== false)
      throw new Error("TEST_ACCOUNT_SCOPE_NOT_EMPTY");
    await work(tx);
  });
}

export async function resetTestDatabase(database: TestDatabase): Promise<void> {
  if (database.config.purpose !== "test" && database.config.purpose !== "ci")
    throw new Error("P2A_TEST_DATABASE_REQUIRED");
  // Reverify marker/role/version before every destructive fixture operation.
  const verified = await openTestDatabase();
  try {
    if (verified.config.instanceId !== database.config.instanceId)
      throw new Error("P2A_TEST_DATABASE_IDENTITY_MISMATCH");
    const lock = await StorageLock.acquire(verified.config);
    const { context, dispose } = createReceiveContext(
      new AbortController().signal,
    );
    try {
      const scan = await scanStorage(verified.config, context);
      const [validationState] = await verified.admin.sql<
        { occupied: boolean }[]
      >`SELECT EXISTS(SELECT 1 FROM qf.quizpack_validation)
        OR EXISTS(SELECT 1 FROM qf.product_asset)
        OR EXISTS(SELECT 1 FROM qf.asset_blob)
        OR EXISTS(SELECT 1 FROM qf.product_draft)
        OR EXISTS(SELECT 1 FROM qf.draft_revision)
        OR EXISTS(SELECT 1 FROM qf.draft_application)
        OR EXISTS(SELECT 1 FROM qf.draft_review)
        OR EXISTS(SELECT 1 FROM qf.product_version)
        OR EXISTS(SELECT 1 FROM qf.internal_play_version)
        OR EXISTS(SELECT 1 FROM qf.access_key)
        OR EXISTS(SELECT 1 FROM qf.consumer_session)
        OR EXISTS(SELECT 1 FROM qf.consumer_grant)
        OR EXISTS(SELECT 1 FROM qf.quiz_report) AS occupied`;
      if (!validationState || validationState.occupied)
        throw new Error("TEST_VALIDATION_SCOPE_NOT_EMPTY");
      const importFiles = new Map(
        [...scan.files].map(([key, files]) => {
          if (!key.startsWith("imports:"))
            throw new Error("TEST_VALIDATION_SCOPE_NOT_EMPTY");
          return [key.slice("imports:".length), files] as const;
        }),
      );
      const rows = await verified.admin.sql<
        ImportRow[]
      >`SELECT * FROM qf.quizpack_import ORDER BY id LIMIT 1025`;
      if (rows.length > 1024) throw new Error("TEST_UPLOAD_CLEANUP_LIMIT");
      const known = new Map(rows.map((row) => [row.id, row]));
      for (const row of rows) {
        for (const a of row.attempts)
          if (
            a.disposition === "held" &&
            !(await stopped(verified.config, row.id, a))
          )
            throw new Error("TEST_UPLOAD_WRITER_UNPROVEN");
      }
      for (const [id, files] of importFiles) {
        const row = known.get(id);
        if (!row) throw new Error("TEST_UPLOAD_OWNER_UNKNOWN");
        const proofs = new Map<string, boolean>();
        for (const a of row.attempts)
          proofs.set(a.attemptId, await stopped(verified.config, id, a));
        if (
          row.attempts.some(
            (a) => a.disposition === "held" && !proofs.get(a.attemptId),
          )
        )
          throw new Error("TEST_UPLOAD_WRITER_UNPROVEN");
        for (const file of files) {
          const name = path.basename(file.file);
          if (
            name !== "archive.quizpack" &&
            !row.attempts.some(
              (a) =>
                proofs.get(a.attemptId) &&
                (name === `attempt-${a.attemptId}.partial` ||
                  name === `stopped-${a.attemptId}.json` ||
                  name.startsWith(`stopped-${a.attemptId}.json.tmp-`)),
            )
          )
            throw new Error("TEST_UPLOAD_FILE_UNPROVEN");
        }
      }
      await lock.check();
      await withEmptyAccountFixtureScope(verified, async (tx) => {
        // Account locks remain held from the emptiness check through every destructive step.
        // Refusal must leave both import files and DB rows intact.
        for (const [id, files] of importFiles) {
          for (const file of files) await removeOwned(file.file, file.inode);
          await rmdir(importDirectory(verified.config, id));
        }
        await lock.check();
        await tx.unsafe(
          `TRUNCATE qf.operator_account_operation,qf.operator_password_token,qf.operator_kdf_attempt,qf.quiz_report,qf.consumer_grant,qf.consumer_session,qf.access_key,qf.internal_play_version,qf.product_version,qf.draft_review,qf.draft_application,qf.draft_revision,qf.product_draft,qf.product_asset,qf.asset_blob,qf.quizpack_validation,qf.quizpack_import,qf.product_tag,qf.product,qf.category,qf.tag,qf.operator_session,qf.audit_event,qf.operator`,
        );
      });
    } finally {
      dispose();
      await lock.close();
    }
  } finally {
    await verified.close();
  }
}

let fixturePasswordHash: Promise<string> | undefined;
/** Current account rows and synthetic sessions for domain tests; password login has its own real suite. */
export async function authenticateTestOperator(
  database: TestDatabase,
  role: "admin" | "operator" | "read-only" = "operator",
) {
  if (database.config.purpose !== "test" && database.config.purpose !== "ci")
    throw new Error("P2A_TEST_DATABASE_REQUIRED");
  const { randomUUID } = await import("node:crypto");
  const { issueToken } = await import("../../src/lib/security/p2a-tokens");
  const { readSession, sessionDto } =
    await import("../../src/lib/auth/service");
  const { withPasswordCapacity } =
    await import("../../src/lib/auth/accounts/password");
  fixturePasswordHash ??= withPasswordCapacity(({ hash }) =>
    hash("synthetic domain fixture password 2026"),
  );
  const passwordHash = await fixturePasswordHash;
  const token = issueToken("session");
  const id = randomUUID();
  await safeTestOperation(
    () =>
      database.admin
        .sql`INSERT INTO qf.operator(id,login_name,display_name,password_hash,role,status) VALUES(${id},${`test-${id}`},'合成领域测试账号',${passwordHash},${role},'active')`,
  );
  await safeTestOperation(
    () => database.admin.sql`
    WITH moment AS(SELECT clock_timestamp() at)
    INSERT INTO qf.operator_session(id,token_digest,kind,operator_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at)
    SELECT ${randomUUID()},${token.digest},'authenticated',${id},at,at,at+interval '30 minutes',at+interval '8 hours' FROM moment`,
  );
  const actor = await safeTestOperation(() =>
    readSession(database.app, token.raw),
  );
  const session = { raw: token.raw, dto: sessionDto(actor, token.raw) };
  return {
    id,
    session,
    credentials: {
      sessionToken: session.raw,
      csrfToken: session.dto.csrfToken,
      requestId: randomUUID(),
    },
  };
}

/** Prevent a driver query/parameter exception from reaching test reporters. */
export async function safeTestOperation<T>(
  work: () => PromiseLike<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const { StudioError } = await import("../../src/lib/http-security/errors");
    if (error instanceof StudioError) throw error;
    throw new Error("TEST_DATABASE_OPERATION_FAILED");
  }
}
