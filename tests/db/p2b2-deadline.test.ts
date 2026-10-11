import { createDatabase } from "../../src/lib/db/client";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import {
  authenticateTestOperator,
  openTestDatabase,
  resetTestDatabase,
  safeTestOperation,
  type TestDatabase,
} from "./p2a-fixture";
import { workspaceService } from "../../src/features/product/workspace/service";
import { importReceiveService } from "../../src/features/quizpack/import/service";
import { configureImports } from "../../src/features/quizpack/import/config-management";
import { createReceiveContext } from "../../src/features/quizpack/import/context";
import { importDirectory } from "../../src/features/quizpack/import/storage";
import type { ImportRow } from "../../src/features/quizpack/import/repository";
let db: TestDatabase;
let actor: Awaited<ReturnType<typeof authenticateTestOperator>>;
beforeAll(async () => {
  db = await openTestDatabase();
});
beforeEach(async () => {
  await resetTestDatabase(db);
  await configureImports(db.config.instanceId, true);
  actor = await authenticateTestOperator(db);
  await workspaceService.createProduct(db.app, actor.credentials, {
    id: "deadline-test",
    slug: "deadline-test",
    title: "Synthetic",
    primaryCategoryId: null,
    tagIds: [],
  });
});
afterAll(async () => {
  await resetTestDatabase(db);
  await db.close();
});
it("real handler-start 60-second stream deadline settles reader and writes stopped proof without late success", async () => {
  const expected = Buffer.from("synthetic");
  const created = await importReceiveService.createIntent(
    db.app,
    actor.credentials,
    "deadline-test",
    randomUUID(),
    {
      expectedArchiveBytes: expected.length,
      expectedArchiveSha256: createHash("sha256")
        .update(expected)
        .digest("hex"),
      target: { kind: "new-draft" },
    },
  );
  let resolve!: (value: IteratorResult<Uint8Array>) => void;
  let started = false;
  const waiting = new Promise<IteratorResult<Uint8Array>>((r) => {
    resolve = r;
  });
  const source = {
    chunks: {
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            started = true;
            return waiting;
          },
        };
      },
    },
    cancel: async () => {
      resolve({ done: true, value: undefined });
      await waiting;
    },
  };
  const beginning = performance.now(),
    { context, dispose } = createReceiveContext(
      new AbortController().signal,
      beginning,
    );
  const requestDb = await createDatabase(db.config, context);
  try {
    await expect(
      safeTestOperation(() =>
        importReceiveService.receiveArchive(
          requestDb,
          actor.credentials,
          "deadline-test",
          created.import.id,
          source,
          context,
        ),
      ),
    ).rejects.toThrow("RECEIVE_TIMEOUT");
  } finally {
    dispose();
    await requestDb.close();
  }
  expect(started).toBe(true);
  const elapsed = performance.now() - beginning;
  expect(elapsed).toBeGreaterThanOrEqual(59900);
  expect(elapsed).toBeLessThan(66000);
  const [r] = await safeTestOperation(
    () =>
      db.admin.sql<
        ImportRow[]
      >`SELECT * FROM qf.quizpack_import WHERE id=${created.import.id}`,
  );
  expect(r?.status).toBe("receiving");
  expect(Number(r?.reserved_bytes)).toBeGreaterThan(0);
  expect(r?.actual_archive_bytes).toBeNull();
  const proof = JSON.parse(
    await readFile(
      path.join(
        importDirectory(db.config, created.import.id),
        `stopped-${r!.current_attempt_id}.json`,
      ),
      "utf8",
    ),
  ) as { attemptId: string };
  expect(proof.attemptId === r?.current_attempt_id).toBe(true);
  const next = createReceiveContext(new AbortController().signal);
  const recoveryDb = await createDatabase(db.config, next.context);
  try {
    const recovered = await importReceiveService.recoverReceive(
      recoveryDb,
      actor.credentials,
      "deadline-test",
      created.import.id,
      { expectedStateRevision: r!.state_revision },
      next.context,
    );
    expect(recovered.status).toBe("awaiting-upload");
  } finally {
    next.dispose();
    await recoveryDb.close();
  }
}, 90000);
