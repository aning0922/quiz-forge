import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createDatabase } from "../../src/lib/db/client";
import {
  authenticateTestOperator,
  openTestDatabase,
  resetTestDatabase,
  safeTestOperation,
  type TestDatabase,
} from "./p2a-fixture";
import { workspaceService } from "../../src/features/product/workspace/service";
import { configureImports } from "../../src/features/quizpack/import/config-management";
import {
  createImportReceiveService,
  importReceiveService,
} from "../../src/features/quizpack/import/service";
import { createReceiveContext } from "../../src/features/quizpack/import/context";
import {
  importDirectory,
  importsDirectory,
  writeStopped,
} from "../../src/features/quizpack/import/storage";
import type { ImportRow } from "../../src/features/quizpack/import/repository";
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return { ...real, mkdir: vi.fn(real.mkdir), open: vi.fn(real.open) };
});
let db: TestDatabase,
  actor: Awaited<ReturnType<typeof authenticateTestOperator>>;
const payload = Buffer.from("synthetic"),
  product = "late-test";
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function create() {
  return (
    await importReceiveService.createIntent(
      db.app,
      actor.credentials,
      product,
      randomUUID(),
      {
        expectedArchiveBytes: payload.length,
        expectedArchiveSha256: createHash("sha256")
          .update(payload)
          .digest("hex"),
        target: { kind: "new-draft" },
      },
    )
  ).import;
}
async function row(id: string) {
  return (
    await safeTestOperation(
      () =>
        db.admin.sql<
          ImportRow[]
        >`SELECT * FROM qf.quizpack_import WHERE id=${id}`,
    )
  )[0]!;
}
async function terminateStorage() {
  const [r] = await safeTestOperation(
    () =>
      db.admin.sql<
        { pid: number }[]
      >`SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=72461 AND objid=2 AND objsubid=2 AND granted`,
  );
  await safeTestOperation(
    () => db.app.sql`SELECT pg_terminate_backend(${r!.pid})`,
  );
}
async function receive(
  id: string,
  service = importReceiveService,
  counter?: () => void,
) {
  const ctx = createReceiveContext(new AbortController().signal),
    request = await createDatabase(db.config, ctx.context);
  try {
    return await service.receiveArchive(
      request,
      actor.credentials,
      product,
      id,
      {
        chunks: {
          async *[Symbol.asyncIterator]() {
            counter?.();
            yield payload;
          },
        },
        cancel: async () => {},
      },
      ctx.context,
    );
  } finally {
    ctx.dispose();
    await request.close();
  }
}
async function recover(id: string) {
  const r = await row(id),
    ctx = createReceiveContext(new AbortController().signal),
    request = await createDatabase(db.config, ctx.context);
  try {
    return await importReceiveService.recoverReceive(
      request,
      actor.credentials,
      product,
      id,
      { expectedStateRevision: r.state_revision },
      ctx.context,
    );
  } finally {
    ctx.dispose();
    await request.close();
  }
}
beforeAll(async () => {
  db = await openTestDatabase();
});
beforeEach(async () => {
  vi.clearAllMocks();
  await resetTestDatabase(db);
  await configureImports(db.config.instanceId, true);
  actor = await authenticateTestOperator(db);
  await workspaceService.createProduct(db.app, actor.credentials, {
    id: product,
    slug: product,
    title: "Synthetic",
    primaryCategoryId: null,
    tagIds: [],
  });
});
afterAll(async () => {
  vi.restoreAllMocks();
  await resetTestDatabase(db);
  await db.close();
});
it("old held late mkdir reserves the invisible 1024th slot, preventing a concurrent 1025th import", async () => {
  const first = await create(),
    second = await create(),
    owned: string[] = [];
  const entered = deferred(),
    release = deferred();
  const real = (await vi.importActual<typeof fs>("node:fs/promises")).mkdir;
  for (let i = 0; i < 1023; i++) {
    const dir = path.join(importsDirectory(db.config), randomUUID());
    await real(dir, { mode: 0o700 });
    owned.push(dir);
  }
  const spy = vi
    .mocked(fs.mkdir)
    .mockImplementation(async (...args: Parameters<typeof fs.mkdir>) => {
      if (String(args[0]) === importDirectory(db.config, first.id)) {
        entered.resolve();
        await release.promise;
      }
      return real(...args);
    });
  const running = receive(first.id).then(
    () => "SUCCESS",
    (e) => (e instanceof Error ? e.message : "FAILED"),
  );
  try {
    await entered.promise;
    await terminateStorage();
    let consumed = 0;
    await expect(
      receive(second.id, importReceiveService, () => {
        consumed++;
      }),
    ).rejects.toThrow("RECEIVE_SCAN_LIMIT");
    expect(consumed).toBe(0);
    expect((await row(second.id)).attempts.length).toBe(0);
    release.resolve();
    expect(await running).toBe("RECEIVE_LOCK_LOST");
    expect((await fs.readdir(importsDirectory(db.config))).length).toBe(1024);
    expect((await recover(first.id)).status).toBe("awaiting-upload");
  } finally {
    release.resolve();
    await running;
    spy.mockImplementation(real);
    for (const dir of owned) await fs.rmdir(dir);
  }
});
it("old held missing partial/archive/receipt/tmp reserve global entries while a real file open finishes late", async () => {
  const first = await create(),
    second = await create(),
    ownedDirs: string[] = [],
    ownedFiles: string[] = [];
  const entered = deferred(),
    release = deferred(),
    real = await vi.importActual<typeof fs>("node:fs/promises");
  for (let i = 0; i < 481; i++) {
    const dir = path.join(importsDirectory(db.config), randomUUID());
    await real.mkdir(dir, { mode: 0o700 });
    ownedDirs.push(dir);
    for (let j = 0; j < 16; j++) {
      const file = path.join(dir, `attempt-${randomUUID()}.partial`);
      await real.writeFile(file, "", { mode: 0o600, flag: "wx" });
      ownedFiles.push(file);
    }
  }
  const current = importDirectory(db.config, first.id);
  await real.mkdir(current, { mode: 0o700 });
  for (let i = 0; i < 5; i++) {
    const file = path.join(current, `attempt-${randomUUID()}.partial`);
    await real.writeFile(file, "", { mode: 0o600, flag: "wx" });
    ownedFiles.push(file);
  }
  const spy = vi
    .mocked(fs.open)
    .mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const file = String(args[0]);
      if (path.dirname(file) === current && file.endsWith(".partial")) {
        entered.resolve();
        await release.promise;
      }
      return real.open(...args);
    });
  const running = receive(first.id).then(
    () => "SUCCESS",
    (e) => (e instanceof Error ? e.message : "FAILED"),
  );
  try {
    await entered.promise;
    await terminateStorage();
    let consumed = 0;
    await expect(
      receive(second.id, importReceiveService, () => {
        consumed++;
      }),
    ).rejects.toThrow("RECEIVE_SCAN_LIMIT");
    expect(consumed).toBe(0);
    expect((await row(second.id)).attempts.length).toBe(0);
    release.resolve();
    expect(await running).toBe("RECEIVE_LOCK_LOST");
    // Remove only the known synthetic orphan names before business recovery (which never deletes unknown files).
    for (const file of ownedFiles) await real.unlink(file);
    ownedFiles.length = 0;
    for (const dir of ownedDirs) await real.rmdir(dir);
    ownedDirs.length = 0;
    expect((await recover(first.id)).status).toBe("awaiting-upload");
  } finally {
    release.resolve();
    await running;
    spy.mockImplementation(real.open);
    for (const file of ownedFiles) await real.unlink(file);
    for (const dir of ownedDirs) await real.rmdir(dir);
  }
}, 30000);
it("published stopped proof is read-only on repeat; afterFreeze loss cannot add a temp after another recovery releases", async () => {
  const created = await create(),
    entered = deferred(),
    release = deferred();
  const real = (await vi.importActual<typeof fs>("node:fs/promises")).open;
  let newTemps = 0;
  const spy = vi
    .mocked(fs.open)
    .mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (String(args[0]).includes(".json.tmp-")) newTemps++;
      return real(...args);
    });
  const service = createImportReceiveService({
    afterFreeze: async () => {
      entered.resolve();
      await release.promise;
    },
  });
  const running = receive(created.id, service).then(
    () => "SUCCESS",
    (e) => (e instanceof Error ? e.message : "FAILED"),
  );
  try {
    await entered.promise;
    const afterPublish = newTemps;
    const r = await row(created.id);
    await writeStopped(db.config, r.id, r.attempts[0]!);
    expect(newTemps).toBe(afterPublish);
    await terminateStorage();
    expect((await recover(created.id)).status).toBe("received");
    release.resolve();
    expect(await running).toBe("RECEIVE_LOCK_LOST");
    expect(newTemps).toBe(afterPublish);
    expect(Number((await row(created.id)).reserved_bytes)).toBe(0);
  } finally {
    release.resolve();
    await running;
    spy.mockImplementation(real);
  }
});
