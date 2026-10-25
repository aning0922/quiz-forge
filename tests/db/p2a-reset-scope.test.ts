import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  lstat,
  mkdir,
  readFile,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  blobPath,
  importDirectory,
  validationDirectory,
} from "@/features/quizpack/import/storage";
import {
  openTestDatabase,
  authenticateTestOperator,
  resetTestDatabase,
  safeTestOperation,
  type TestDatabase,
} from "./p2a-fixture";
import { resetDomainDatabase } from "./p2b2b-domain-fixture";
import { configureImports } from "@/features/quizpack/import/config-management";
import { importReceiveService } from "@/features/quizpack/import/service";
import { createReceiveContext } from "@/features/quizpack/import/context";
import { createDatabase } from "@/lib/db/client";
import { workspaceService } from "@/features/product/workspace/service";

let database: TestDatabase;
beforeAll(async () => {
  database = await openTestDatabase();
  await resetTestDatabase(database);
});
afterAll(async () => {
  await database?.close();
});

it("resets the legacy fixture with empty validation foreign-key tables", async () => {
  await expect(resetTestDatabase(database)).resolves.toBeUndefined();
});

it("preserves a blob declaration instead of extending legacy cleanup authority", async () => {
  const sha = "d".repeat(64);
  await safeTestOperation(
    () => database.admin.sql`
    INSERT INTO qf.asset_blob(sha256,bytes,media_type,width,height,frames,storage_key,created_at)
    VALUES(${sha},1,'image/png',1,1,1,${`blobs/${sha}.blob`},clock_timestamp())`,
  );
  try {
    await expect(resetTestDatabase(database)).rejects.toThrow(
      "TEST_VALIDATION_SCOPE_NOT_EMPTY",
    );
    const rows = await database.admin.sql`
      SELECT sha256 FROM qf.asset_blob WHERE sha256=${sha}`;
    expect(rows).toHaveLength(1);
  } finally {
    // This test created only this no-file synthetic declaration.
    await resetDomainDatabase(database);
  }
});

it("preserves an empty validation directory before deleting any import files", async () => {
  const directory = validationDirectory(database.config, randomUUID());
  await mkdir(directory, { mode: 0o700 });
  try {
    await expect(resetTestDatabase(database)).rejects.toThrow(
      "TEST_VALIDATION_SCOPE_NOT_EMPTY",
    );
    expect((await lstat(directory)).isDirectory()).toBe(true);
  } finally {
    await rmdir(directory);
  }
});

it("preserves an unclaimed blob file rather than treating it as an import", async () => {
  const file = blobPath(database.config, "e".repeat(64));
  const bytes = Buffer.from("synthetic reset boundary");
  await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
  try {
    await expect(resetTestDatabase(database)).rejects.toThrow(
      "TEST_VALIDATION_SCOPE_NOT_EMPTY",
    );
    expect(await readFile(file)).toEqual(bytes);
  } finally {
    await unlink(file);
  }
});

it("refuses occupied account scope before deleting any owned import file or row", async () => {
  await configureImports(database.config.instanceId, true);
  const actor = await authenticateTestOperator(database);
  const productId = `account-scope-${randomUUID()}`;
  const payload = Buffer.from(
    "synthetic received bytes for fixture ownership, not a validated QuizPack",
  );
  const digest = (value: string | Uint8Array) =>
    createHash("sha256").update(value).digest("hex");
  await workspaceService.createProduct(database.app, actor.credentials, {
    id: productId,
    slug: productId,
    title: "账号清理边界合成测评",
    primaryCategoryId: null,
    tagIds: [],
  });
  const intent = await importReceiveService.createIntent(
    database.app,
    actor.credentials,
    productId,
    randomUUID(),
    {
      expectedArchiveBytes: payload.length,
      expectedArchiveSha256: digest(payload),
      target: { kind: "new-draft" },
    },
  );
  const { context, dispose } = createReceiveContext(
    new AbortController().signal,
  );
  const requestDb = await createDatabase(database.config, context);
  try {
    await importReceiveService.receiveArchive(
      requestDb,
      actor.credentials,
      productId,
      intent.import.id,
      {
        chunks: {
          async *[Symbol.asyncIterator]() {
            yield payload;
          },
        },
        cancel: async () => {},
      },
      context,
    );
  } finally {
    dispose();
    await requestDb.close();
  }
  const file = path.join(
    importDirectory(database.config, intent.import.id),
    "archive.quizpack",
  );
  const inode = (await lstat(file)).ino;
  const op = randomUUID();
  // A committed synthetic receipt owned by this test; legacy fixtures do not own it.
  await safeTestOperation(
    () => database.admin.sql`
    INSERT INTO qf.operator_account_operation(operation_id,actor_id,target_id,action,binding,status)
    VALUES(${op},${actor.id},${actor.id},'display-name','{}'::jsonb,'completed')`,
  );
  const snapshot = async () => {
    const [row] = await safeTestOperation(
      () => database.admin.sql<{ body: string }[]>`
      SELECT to_jsonb(q)::text body FROM qf.quizpack_import q WHERE id=${intent.import.id}`,
    );
    if (!row) throw new Error("TEST_IMPORT_ROW_MISSING");
    return digest(row.body);
  };
  const before = await snapshot();
  let verified = false;
  try {
    await expect(resetTestDatabase(database)).rejects.toThrow(
      "TEST_ACCOUNT_SCOPE_NOT_EMPTY",
    );
    expect(await readFile(file)).toEqual(payload);
    expect((await lstat(file)).ino).toBe(inode);
    expect(await snapshot()).toBe(before);
    const [receipt] = await safeTestOperation(
      () => database.admin.sql<{ n: number }[]>`
      SELECT count(*)::int n FROM qf.operator_account_operation WHERE operation_id=${op}`,
    );
    expect(receipt?.n).toBe(1);
    verified = true;
  } finally {
    // Failed/unknown evidence stays intact. Only confirmed success permits this test's cleanup.
    if (verified) {
      await safeTestOperation(
        () =>
          database.admin
            .sql`DELETE FROM qf.operator_account_operation WHERE operation_id=${op}`,
      );
      await resetTestDatabase(database);
      await configureImports(database.config.instanceId, false);
    }
  }
});
