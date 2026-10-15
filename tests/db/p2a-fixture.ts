import { rmdir } from "node:fs/promises";
import path from "node:path";
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
        OR EXISTS(SELECT 1 FROM qf.asset_blob) AS occupied`;
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
      // Verify all ownership/stopping before deleting a single file or truncating any business row.
      for (const [id, files] of importFiles) {
        for (const file of files) await removeOwned(file.file, file.inode);
        await rmdir(importDirectory(verified.config, id));
      }
      await lock.check();
      await verified.admin
        .sql`TRUNCATE qf.product_asset,qf.asset_blob,qf.quizpack_validation,qf.quizpack_import,qf.product_tag,qf.product,qf.category,qf.tag,qf.operator_session,qf.audit_event,qf.operator`;
    } finally {
      dispose();
      await lock.close();
    }
  } finally {
    await verified.close();
  }
}

/** Synthetic sessions for B1 domain/HTTP tests; raw values stay inside test process. */
export async function authenticateTestOperator(
  database: TestDatabase,
  role: "operator" | "read-only" = "operator",
) {
  const { randomUUID } = await import("node:crypto");
  const { issueToken } = await import("../../src/lib/security/p2a-tokens");
  const { createPreauth, login } = await import("../../src/lib/auth/service");
  const credential = issueToken("credential");
  const id = randomUUID();
  await safeTestOperation(
    () =>
      database.admin
        .sql`INSERT INTO qf.operator(id,label,credential_digest,role,status) VALUES(${id},${`test-${id}`},${credential.digest},${role},'active')`,
  );
  const preauth = await safeTestOperation(() =>
    createPreauth(database.app, null, randomUUID()),
  );
  const session = await safeTestOperation(() =>
    login(
      database.app,
      preauth.raw,
      preauth.dto.csrfToken,
      credential.raw,
      randomUUID(),
    ),
  );
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
