import { randomUUID } from "node:crypto";
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
  validationDirectory,
} from "@/features/quizpack/import/storage";
import {
  openTestDatabase,
  resetTestDatabase,
  safeTestOperation,
  type TestDatabase,
} from "./p2a-fixture";
import { resetDomainDatabase } from "./p2b2b-domain-fixture";

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
