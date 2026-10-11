import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
  writeStopped,
} from "../../src/features/quizpack/import/storage";
import { StorageLock } from "../../src/features/quizpack/import/storage-lock";
import { StudioError } from "../../src/lib/http-security/errors";
import type { ImportRow } from "../../src/features/quizpack/import/repository";
import type { ReceiveSource } from "../../src/features/quizpack/import/service-contract";
let db: TestDatabase;
let actor: Awaited<ReturnType<typeof authenticateTestOperator>>;
const productId = "receive-test";
const bytes = Buffer.from("synthetic raw archive bytes, not validated zip");
const intent = {
  expectedArchiveBytes: bytes.length,
  expectedArchiveSha256: createHash("sha256").update(bytes).digest("hex"),
  target: { kind: "new-draft" as const },
};
async function create(
  input = intent,
  key = randomUUID(),
  service = importReceiveService,
) {
  return safeTestOperation(() =>
    service.createIntent(db.app, actor.credentials, productId, key, input),
  );
}
async function row(id: string) {
  const [r] = await safeTestOperation(
    () =>
      db.admin.sql<
        ImportRow[]
      >`SELECT * FROM qf.quizpack_import WHERE id=${id}`,
  );
  return r!;
}
function source(payload = bytes) {
  let read = 0,
    cancelled = 0;
  return {
    source: {
      chunks: {
        async *[Symbol.asyncIterator]() {
          read++;
          yield payload;
        },
      },
      cancel: async () => {
        cancelled++;
      },
    },
    counts: () => ({ read, cancelled }),
  };
}
async function receive(
  id: string,
  src: ReceiveSource,
  service = importReceiveService,
) {
  const { context, dispose } = createReceiveContext(
    new AbortController().signal,
  );
  try {
    return await safeTestOperation(() =>
      service.receiveArchive(
        db.app,
        actor.credentials,
        productId,
        id,
        src,
        context,
      ),
    );
  } finally {
    dispose();
  }
}
async function recover(id: string, service = importReceiveService) {
  const current = await importReceiveService.readImport(
    db.app,
    actor.session.raw,
    productId,
    id,
  );
  const { context, dispose } = createReceiveContext(
    new AbortController().signal,
  );
  try {
    return await safeTestOperation(() =>
      service.recoverReceive(
        db.app,
        actor.credentials,
        productId,
        id,
        { expectedStateRevision: current.stateRevision },
        context,
      ),
    );
  } finally {
    dispose();
  }
}
beforeAll(async () => {
  db = await openTestDatabase();
});
afterAll(async () => {
  await resetTestDatabase(db);
  await db.close();
});
beforeEach(async () => {
  await resetTestDatabase(db);
  await configureImports(db.config.instanceId, true);
  actor = await authenticateTestOperator(db);
  await safeTestOperation(() =>
    workspaceService.createProduct(db.app, actor.credentials, {
      id: productId,
      slug: productId,
      title: "合成接收",
      primaryCategoryId: null,
      tagIds: [],
    }),
  );
});
describe("B2-1 actual PostgreSQL and private bytes", () => {
  it("replays exact intent and verifies lost create response by exact key", async () => {
    const key = randomUUID();
    const created = await create(intent, key);
    expect(created.created).toBe(true);
    expect((await create(intent, key)).created).toBe(false);
    await expect(
      create(
        { ...intent, expectedArchiveBytes: intent.expectedArchiveBytes + 1 },
        key,
      ),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    const lostKey = randomUUID();
    const service = createImportReceiveService({
      afterCommit: async (kind) => {
        if (kind === "intent") throw new StudioError("WRITE_OUTCOME_UNKNOWN");
      },
    });
    await expect(create(intent, lostKey, service)).rejects.toThrow(
      "WRITE_OUTCOME_UNKNOWN",
    );
    // Independent admin connection confirms the actual committed row; no driver/mock inference.
    const [fact] = await safeTestOperation(
      () =>
        db.admin.sql<
          { count: number }[]
        >`SELECT count(*)::int count FROM qf.quizpack_import WHERE product_id=${productId} AND idempotency_key=${lostKey}`,
    );
    expect(fact?.count).toBe(1);
    const found = await importReceiveService.listImports(
      db.app,
      actor.session.raw,
      productId,
      { page: 1, pageSize: 1, idempotencyKey: lostKey },
    );
    expect(found.total).toBe(1);
    expect((await create(intent, lostKey)).import.id).toBe(found.items[0]?.id);
  });
  it("enforces 20/+1 pending intents and replay before the limit", async () => {
    const key = randomUUID();
    await create(intent, key);
    for (let i = 1; i < 20; i++) await create();
    await expect(create()).rejects.toThrow("IMPORT_INTENT_LIMIT");
    expect((await create(intent, key)).created).toBe(false);
  });
  it("freezes actual bytes, keeps received unvalidated and cancels repeated input", async () => {
    const created = await create();
    const src = source();
    const result = await receive(created.import.id, src.source);
    expect(result).toMatchObject({
      status: "received",
      actualArchiveBytes: bytes.length,
      actualArchiveSha256: intent.expectedArchiveSha256,
      validationStatus: "not-run",
      publishable: false,
    });
    const file = path.join(
      importDirectory(db.config, result.id),
      "archive.quizpack",
    );
    expect((await readFile(file)).equals(bytes)).toBe(true);
    expect((await lstat(file)).mode & 0o777).toBe(0o600);
    const r = await row(result.id);
    expect(Number(r.reserved_bytes)).toBe(0);
    expect(r.attempts[0]?.disposition).toBe("released");
    const repeat = source(Buffer.from("different"));
    expect((await receive(result.id, repeat.source)).stateRevision).toBe(
      result.stateRevision,
    );
    expect(repeat.counts().read).toBe(0);
    expect(repeat.counts().cancelled).toBeGreaterThan(0);
  });
  it("checks each chunk before writing and retains rejected identity through cleanup", async () => {
    const created = await create({ ...intent, expectedArchiveBytes: 1 });
    await expect(receive(created.import.id, source().source)).rejects.toThrow(
      "RECEIVE_LENGTH_MISMATCH",
    );
    const r = await row(created.import.id);
    expect(r.status).toBe("rejected");
    expect(Number(r.reserved_bytes)).toBeGreaterThan(0);
    const partial = path.join(
      importDirectory(db.config, r.id),
      `attempt-${r.current_attempt_id}.partial`,
    );
    expect((await lstat(partial)).size).toBe(0);
    const cleaned = await recover(r.id);
    expect(cleaned).toMatchObject({
      status: "rejected",
      storageCondition: "clean",
    });
    await expect(receive(r.id, source().source)).rejects.toThrow(
      "IMPORT_STATE_CONFLICT",
    );
  });
  it("recovers a frozen file after completion response was lost without overwrite", async () => {
    const created = await create();
    const service = createImportReceiveService({
      afterCommit: async (kind) => {
        if (kind === "complete") throw new StudioError("WRITE_OUTCOME_UNKNOWN");
      },
    });
    await expect(
      receive(created.import.id, source().source, service),
    ).rejects.toThrow("WRITE_OUTCOME_UNKNOWN");
    expect((await row(created.import.id)).status).toBe("received");
    const recovered = await recover(created.import.id);
    expect(recovered.status).toBe("received");
    expect(
      (
        await readFile(
          path.join(
            importDirectory(db.config, recovered.id),
            "archive.quizpack",
          ),
        )
      ).equals(bytes),
    ).toBe(true);
  });
  it("does not consume body when claim committed but response was lost", async () => {
    const created = await create();
    const src = source();
    const service = createImportReceiveService({
      afterCommit: async (kind) => {
        if (kind === "claim") throw new StudioError("WRITE_OUTCOME_UNKNOWN");
      },
    });
    await expect(
      receive(created.import.id, src.source, service),
    ).rejects.toThrow("WRITE_OUTCOME_UNKNOWN");
    expect(src.counts().read).toBe(0);
    const r = await row(created.import.id);
    expect(r.status).toBe("receiving");
    expect(Number(r.reserved_bytes)).toBeGreaterThan(0);
    await expect(recover(r.id)).rejects.toThrow("RECEIVE_RECOVERY_REQUIRED");
    // The test owns and has settled this non-writing attempt. A receipt is created solely for fixture cleanup.
    await mkdir(importDirectory(db.config, r.id), { mode: 0o700 });
    await writeStopped(db.config, r.id, r.attempts[0]!);
    await recover(r.id);
  });
  it("auth revocation in file stage blocks completion; fresh operator can recover old receipt/new fence", async () => {
    const created = await create();
    const originalActor = actor;
    const service = createImportReceiveService({
      afterFreeze: async () => {
        const { logout } = await import("../../src/lib/auth/service");
        await safeTestOperation(() =>
          logout(
            db.app,
            originalActor.session.raw,
            originalActor.session.dto.csrfToken,
            randomUUID(),
          ),
        );
      },
    });
    await expect(
      receive(created.import.id, source().source, service),
    ).rejects.toThrow("UNAUTHENTICATED");
    const r = await row(created.import.id);
    expect(r.status).toBe("receiving");
    actor = await authenticateTestOperator(db);
    const result = await recover(r.id);
    expect(result.status).toBe("received");
    const after = await row(r.id);
    expect(after.fence).toBe(r.fence + 1);
    expect(after.attempts[0]?.fence).toBe(r.fence);
    expect(after.created_by).toBe(originalActor.id);
  });
  it("storage lock is independent and permanently invalid after a real backend termination", async () => {
    const lock = await StorageLock.acquire(db.config);
    const [pid] = await lock.connection<
      { pid: number }[]
    >`SELECT pg_backend_pid() pid`;
    await expect(StorageLock.acquire(db.config)).rejects.toThrow(
      "RECEIVE_BUSY",
    );
    await safeTestOperation(
      () => db.app.sql`SELECT pg_terminate_backend(${pid!.pid})`,
    );
    await expect(lock.check()).rejects.toThrow("RECEIVE_LOCK_LOST");
    await expect(lock.connection`SELECT 1`).rejects.toBeDefined();
    expect(() => lock.assert()).toThrow("RECEIVE_LOCK_LOST");
    await lock.close();
    const next = await StorageLock.acquire(db.config);
    await next.close();
  });
  it("settings disabled is a read snapshot; authoritative writes reject without reading input", async () => {
    const created = await create();
    await configureImports(db.config.instanceId, false);
    expect(
      (
        await importReceiveService.readImportSettings(
          db.app,
          actor.session.raw,
          productId,
        )
      ).enabled,
    ).toBe(false);
    const src = source();
    await expect(receive(created.import.id, src.source)).rejects.toThrow(
      "IMPORTS_DISABLED",
    );
    expect(src.counts().read).toBe(0);
    expect(src.counts().cancelled).toBeGreaterThan(0);
    expect(
      (
        await importReceiveService.readImport(
          db.app,
          actor.session.raw,
          productId,
          created.import.id,
        )
      ).status,
    ).toBe("awaiting-upload");
  });
  it("actual write/sync/link/unlink faults preserve real file/ledger facts", async () => {
    for (const operation of ["write", "sync", "link", "unlink"] as const) {
      const created = await create();
      let fired = false;
      const service = createImportReceiveService({
        beforeIo: async (op) => {
          if (op === operation && !fired) {
            fired = true;
            throw Object.assign(new Error("IO_FAILED"), { code: "ENOSPC" });
          }
        },
      });
      await expect(
        receive(created.import.id, source().source, service),
      ).rejects.toThrow("RECEIVE_STORAGE_CONFLICT");
      const r = await row(created.import.id);
      expect(Number(r.reserved_bytes)).toBeGreaterThan(0);
      const result = await recover(r.id);
      expect(result.status).toBe(
        operation === "unlink" ? "received" : "awaiting-upload",
      );
    }
  });
  it("three attempts, valid receipts and explicit recovery never reset the attempt budget", async () => {
    const created = await create();
    for (let i = 0; i < 3; i++) {
      const service = createImportReceiveService({
        beforeIo: async (op) => {
          if (op === "write") throw new Error("IO_FAILED");
        },
      });
      await expect(
        receive(created.import.id, source().source, service),
      ).rejects.toThrow("RECEIVE_STORAGE_CONFLICT");
      await recover(created.import.id);
    }
    await expect(receive(created.import.id, source().source)).rejects.toThrow(
      "RECEIVE_ATTEMPT_LIMIT",
    );
    expect((await row(created.import.id)).attempts).toHaveLength(3);
  });
  it("rejects cross-product access and read-only write identity", async () => {
    const created = await create();
    await safeTestOperation(() =>
      workspaceService.createProduct(db.app, actor.credentials, {
        id: "other-product",
        slug: "other-product",
        title: "其他",
        primaryCategoryId: null,
        tagIds: [],
      }),
    );
    await expect(
      importReceiveService.readImport(
        db.app,
        actor.session.raw,
        "other-product",
        created.import.id,
      ),
    ).rejects.toThrow("IMPORT_NOT_FOUND");
    const viewer = await authenticateTestOperator(db, "read-only");
    await expect(
      importReceiveService.createIntent(
        db.app,
        viewer.credentials,
        productId,
        randomUUID(),
        intent,
      ),
    ).rejects.toThrow("CAPABILITY_DENIED");
  });
});
