import net from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  openTestDatabase,
  safeTestOperation,
  type TestDatabase,
} from "./p2a-fixture";
import { StorageLock } from "../../src/features/quizpack/import/storage-lock";
let db: TestDatabase;
beforeAll(async () => {
  db = await openTestDatabase();
});
afterAll(async () => {
  await db.close();
});
/** Test-owned TCP forwarder: no logging of wire bytes (SCRAM/auth are private). */
async function blackhole() {
  const sockets = new Set<net.Socket>();
  let discard = false;
  const server = net.createServer((front) => {
    const back = net.createConnection({
      host: "127.0.0.1",
      port: db.config.database.port,
    });
    sockets.add(front);
    sockets.add(back);
    front.on("data", (chunk) => {
      if (!back.destroyed) back.write(chunk);
    });
    back.on("data", (chunk) => {
      if (!discard && !front.destroyed) front.write(chunk);
    });
    for (const [a, b] of [
      [front, back],
      [back, front],
    ] as const) {
      a.on("error", () => {});
      a.once("close", () => {
        sockets.delete(a);
        b.destroy();
      });
    }
  });
  await new Promise<void>((r, j) => {
    server.once("error", () => j(new Error("TEST_PROXY_FAILED")));
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => r());
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("TEST_PROXY_REQUIRED");
  return {
    config: {
      ...db.config,
      database: { ...db.config.database, port: address.port },
    },
    drop: () => {
      discard = true;
    },
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
it("real established socket withholding PG replies expires check within 2s, invalidates old reserved and lets close finish", async () => {
  const proxy = await blackhole();
  let lock: StorageLock | undefined;
  try {
    lock = await StorageLock.acquire(proxy.config);
    proxy.drop();
    const started = performance.now();
    await expect(lock.check()).rejects.toThrow("RECEIVE_LOCK_LOST");
    expect(performance.now() - started).toBeLessThan(2400);
    expect(lock.controller.signal.aborted).toBe(true);
    expect(() => lock!.assert()).toThrow("RECEIVE_LOCK_LOST");
    const oldFailed = await safeTestOperation(async () => {
      try {
        await lock!.connection`SELECT 1`;
        return false;
      } catch {
        return true;
      }
    });
    expect(oldFailed).toBe(true);
    const closing = performance.now();
    await lock.close();
    expect(performance.now() - closing).toBeLessThan(2400);
  } finally {
    await lock?.close();
    await proxy.close();
  }
});
it("real withholding socket also bounds unlock instead of waiting indefinitely", async () => {
  const proxy = await blackhole();
  let lock: StorageLock | undefined;
  try {
    lock = await StorageLock.acquire(proxy.config);
    proxy.drop();
    const started = performance.now();
    await lock.close();
    expect(performance.now() - started).toBeLessThan(2400);
    expect(lock.controller.signal.aborted).toBe(true);
    expect(() => lock!.assert()).toThrow("RECEIVE_LOCK_LOST");
  } finally {
    await lock?.close();
    await proxy.close();
  }
});
it("reserve/handshake withholding response rejects unknown within fixed acquisition deadline", async () => {
  const proxy = await blackhole();
  proxy.drop();
  const started = performance.now();
  try {
    await expect(StorageLock.acquire(proxy.config)).rejects.toThrow(
      "WRITE_OUTCOME_UNKNOWN",
    );
    expect(performance.now() - started).toBeLessThan(2400);
  } finally {
    await proxy.close();
  }
});
it("createDatabase owns its client before first identity reply and closes it at the same absolute deadline", async () => {
  const { createDatabase } = await import("../../src/lib/db/client");
  const proxy = await blackhole();
  proxy.drop();
  try {
    const config = {
      ...proxy.config,
      server: { ...proxy.config.server, port: proxy.config.database.port },
    };
    const start = performance.now();
    await expect(
      createDatabase(config, {
        signal: new AbortController().signal,
        deadlineMonotonicMs: start + 100,
      }),
    ).rejects.toThrow("RECEIVE_TIMEOUT");
    expect(performance.now() - start).toBeLessThan(1000);
  } finally {
    await proxy.close();
  }
});
it("receive read on a real withholding request socket expires, cancels untouched body and permanently closes only request DB", async () => {
  const { resetTestDatabase, authenticateTestOperator } =
    await import("./p2a-fixture");
  await resetTestDatabase(db);
  const { configureImports } =
    await import("../../src/features/quizpack/import/config-management");
  await configureImports(db.config.instanceId, true);
  const actor = await authenticateTestOperator(db);
  const { workspaceService } =
    await import("../../src/features/product/workspace/service");
  await workspaceService.createProduct(db.app, actor.credentials, {
    id: "request-budget",
    slug: "request-budget",
    title: "Synthetic",
    primaryCategoryId: null,
    tagIds: [],
  });
  const { importReceiveService } =
      await import("../../src/features/quizpack/import/service"),
    { randomUUID } = await import("node:crypto");
  const created = await importReceiveService.createIntent(
    db.app,
    actor.credentials,
    "request-budget",
    randomUUID(),
    {
      expectedArchiveBytes: 1,
      expectedArchiveSha256: "a".repeat(64),
      target: { kind: "new-draft" },
    },
  );
  const proxy = await blackhole();
  const { openSql, verifyDatabaseIdentity } =
    await import("../../src/lib/db/client");
  const sql = openSql(proxy.config.database, 1);
  await verifyDatabaseIdentity(sql, db.config);
  const request = { ...db.app, sql, close: () => sql.end({ timeout: 0 }) };
  proxy.drop();
  let consumed = false,
    cancelled = false;
  try {
    const context = {
      signal: new AbortController().signal,
      deadlineMonotonicMs: performance.now() + 100,
    };
    await expect(
      importReceiveService.receiveArchive(
        request,
        actor.credentials,
        "request-budget",
        created.import.id,
        {
          chunks: {
            async *[Symbol.asyncIterator]() {
              consumed = true;
              yield new Uint8Array([1]);
            },
          },
          cancel: async () => {
            cancelled = true;
          },
        },
        context,
      ),
    ).rejects.toThrow("RECEIVE_TIMEOUT");
    expect(consumed).toBe(false);
    expect(cancelled).toBe(true);
    const stale = await safeTestOperation(async () => {
      try {
        await sql`SELECT 1`;
        return false;
      } catch {
        return true;
      }
    });
    expect(stale).toBe(true);
    expect(
      (
        await importReceiveService.readImport(
          db.app,
          actor.session.raw,
          "request-budget",
          created.import.id,
        )
      ).status,
    ).toBe("awaiting-upload");
  } finally {
    await request.close();
    await proxy.close();
    await resetTestDatabase(db);
  }
});
it("potential final write on withholding request socket reports unknown, preserves archive and fresh DB can recover", async () => {
  const { resetTestDatabase, authenticateTestOperator } =
    await import("./p2a-fixture");
  await resetTestDatabase(db);
  const { configureImports } =
    await import("../../src/features/quizpack/import/config-management");
  await configureImports(db.config.instanceId, true);
  const actor = await authenticateTestOperator(db);
  const { workspaceService } =
    await import("../../src/features/product/workspace/service");
  await workspaceService.createProduct(db.app, actor.credentials, {
    id: "write-budget",
    slug: "write-budget",
    title: "Synthetic",
    primaryCategoryId: null,
    tagIds: [],
  });
  const { importReceiveService, createImportReceiveService } =
      await import("../../src/features/quizpack/import/service"),
    { randomUUID, createHash } = await import("node:crypto");
  const payload = new Uint8Array([1]);
  const created = await importReceiveService.createIntent(
    db.app,
    actor.credentials,
    "write-budget",
    randomUUID(),
    {
      expectedArchiveBytes: 1,
      expectedArchiveSha256: createHash("sha256").update(payload).digest("hex"),
      target: { kind: "new-draft" },
    },
  );
  const proxy = await blackhole(),
    { openSql, verifyDatabaseIdentity, createDatabase } =
      await import("../../src/lib/db/client");
  const sql = openSql(proxy.config.database, 1);
  await verifyDatabaseIdentity(sql, db.config);
  const request = { ...db.app, sql, close: () => sql.end({ timeout: 0 }) };
  const context = {
    signal: new AbortController().signal,
    deadlineMonotonicMs: performance.now() + 60000,
  };
  const service = createImportReceiveService({
    afterFreeze: async () => {
      proxy.drop();
      context.deadlineMonotonicMs = performance.now() + 100;
    },
  });
  try {
    await expect(
      service.receiveArchive(
        request,
        actor.credentials,
        "write-budget",
        created.import.id,
        {
          chunks: {
            async *[Symbol.asyncIterator]() {
              yield payload;
            },
          },
          cancel: async () => {},
        },
        context,
      ),
    ).rejects.toThrow("WRITE_OUTCOME_UNKNOWN");
    const snapshot = await importReceiveService.readImport(
      db.app,
      actor.session.raw,
      "write-budget",
      created.import.id,
    );
    expect(snapshot.status).toBe("receiving");
    const { importDirectory } =
        await import("../../src/features/quizpack/import/storage"),
      { readFile } = await import("node:fs/promises"),
      path = await import("node:path");
    expect(
      (
        await readFile(
          path.join(
            importDirectory(db.config, created.import.id),
            "archive.quizpack",
          ),
        )
      ).length,
    ).toBe(1);
    const fresh = await createDatabase(db.config);
    try {
      const recovered = await importReceiveService.recoverReceive(
        fresh,
        actor.credentials,
        "write-budget",
        created.import.id,
        { expectedStateRevision: snapshot.stateRevision },
        {
          signal: new AbortController().signal,
          deadlineMonotonicMs: performance.now() + 60000,
        },
      );
      expect(recovered.status).toBe("received");
    } finally {
      await fresh.close();
    }
  } finally {
    await request.close();
    await proxy.close();
    await resetTestDatabase(db);
  }
});
