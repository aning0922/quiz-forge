import { createDatabase } from "../../src/lib/db/client";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  unlink,
  writeFile,
  rmdir,
  open,
} from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
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
  ownerExited,
} from "../../src/features/quizpack/import/storage";
import type { ImportRow } from "../../src/features/quizpack/import/repository";
import type { ReceiveSource } from "../../src/features/quizpack/import/service-contract";
let db: TestDatabase,
  actor: Awaited<ReturnType<typeof authenticateTestOperator>>;
const payload = Buffer.from("synthetic bytes"),
  productId = "boundary-test";
const expected = {
  expectedArchiveBytes: payload.length,
  expectedArchiveSha256: createHash("sha256").update(payload).digest("hex"),
  target: { kind: "new-draft" as const },
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function create(input = expected) {
  return (
    await importReceiveService.createIntent(
      db.app,
      actor.credentials,
      productId,
      randomUUID(),
      input,
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
async function receive(
  id: string,
  source: ReceiveSource,
  service = importReceiveService,
  timeout?: number,
) {
  const ctx = createReceiveContext(new AbortController().signal);
  if (timeout !== undefined)
    ctx.context.deadlineMonotonicMs = performance.now() + timeout;
  const requestDb = await createDatabase(db.config, ctx.context);
  try {
    return await service.receiveArchive(
      requestDb,
      actor.credentials,
      productId,
      id,
      source,
      ctx.context,
    );
  } finally {
    ctx.dispose();
    await requestDb.close();
  }
}
const source = (bytes = payload): ReceiveSource => ({
  chunks: {
    async *[Symbol.asyncIterator]() {
      yield bytes;
    },
  },
  cancel: async () => {},
});
async function recover(id: string) {
  const current = await row(id),
    ctx = createReceiveContext(new AbortController().signal);
  const requestDb = await createDatabase(db.config, ctx.context);
  try {
    return await importReceiveService.recoverReceive(
      requestDb,
      actor.credentials,
      productId,
      id,
      { expectedStateRevision: current.state_revision },
      ctx.context,
    );
  } finally {
    ctx.dispose();
    await requestDb.close();
  }
}
beforeAll(async () => {
  db = await openTestDatabase();
});
beforeEach(async () => {
  await resetTestDatabase(db);
  await configureImports(db.config.instanceId, true);
  actor = await authenticateTestOperator(db);
  await workspaceService.createProduct(db.app, actor.credentials, {
    id: productId,
    slug: productId,
    title: "Synthetic",
    primaryCategoryId: null,
    tagIds: [],
  });
});
afterAll(async () => {
  await resetTestDatabase(db);
  await db.close();
});
it("test-owned alive PID cannot be recovered; ESRCH after child exit allows new recovery fence", async () => {
  const created = await create();
  const child = spawn(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", "tests/db/p2b2-child.ts"],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  const ready = deferred(),
    claimed = deferred();
  let failed = false;
  child.on(
    "message",
    (m: { ready?: boolean; claimed?: boolean; failed?: boolean }) => {
      if (m.ready) ready.resolve();
      if (m.claimed) claimed.resolve();
      if (m.failed) {
        failed = true;
        claimed.resolve();
      }
    },
  );
  const exited = new Promise<void>((r) => child.once("exit", () => r()));
  try {
    await ready.promise;
    child.send({
      credentials: actor.credentials,
      productId,
      importId: created.id,
    });
    await claimed.promise;
    expect(failed).toBe(false);
    const r = await row(created.id);
    expect(r.attempts[0]?.ownerPid === child.pid).toBe(true);
    const [storage] = await safeTestOperation(
      () =>
        db.admin.sql<
          { pid: number }[]
        >`SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=72461 AND objid=2 AND objsubid=2 AND granted`,
    );
    await safeTestOperation(
      () => db.app.sql`SELECT pg_terminate_backend(${storage!.pid})`,
    );
    await expect(recover(created.id)).rejects.toThrow(
      "RECEIVE_RECOVERY_REQUIRED",
    );
    child.kill("SIGTERM");
    await exited;
    expect(ownerExited(r.attempts[0]!.ownerPid)).toBe(true);
    const result = await recover(created.id);
    expect(result.status).toBe("awaiting-upload");
    const latest = await row(created.id);
    expect(latest.fence).toBe(r.fence + 1);
    expect(latest.attempts[0]?.fence).toBe(r.fence);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await exited;
    }
  }
});
it("pending read and unresolved cancellation never create stopped receipt or release held budget", async () => {
  const created = await create();
  let resolveRead!: (value: IteratorResult<Uint8Array>) => void;
  const pending = new Promise<IteratorResult<Uint8Array>>((r) => {
    resolveRead = r;
  });
  const cancel = deferred();
  const src: ReceiveSource = {
    chunks: {
      [Symbol.asyncIterator]() {
        return { next: () => pending };
      },
    },
    cancel: () => cancel.promise,
  };
  await expect(
    receive(created.id, src, importReceiveService, 50),
  ).rejects.toThrow("RECEIVE_TIMEOUT");
  const r = await row(created.id);
  expect(Number(r.reserved_bytes)).toBeGreaterThan(0);
  expect(
    (await readdir(importDirectory(db.config, r.id))).some((n) =>
      n.startsWith("stopped-"),
    ),
  ).toBe(false);
  await expect(recover(r.id)).rejects.toThrow("RECEIVE_RECOVERY_REQUIRED");
  resolveRead({ done: true, value: undefined });
  await pending;
  cancel.resolve();
  await cancel.promise;
  await writeStopped(db.config, r.id, r.attempts[0]!);
  await recover(r.id);
});
it("hash mismatch is rejected, cannot be retried and valid stopped cleanup is idempotent", async () => {
  const created = await create({
    ...expected,
    expectedArchiveSha256: "a".repeat(64),
  });
  await expect(receive(created.id, source())).rejects.toThrow(
    "RECEIVE_HASH_MISMATCH",
  );
  expect((await row(created.id)).status).toBe("rejected");
  const first = await recover(created.id);
  expect(first.status).toBe("rejected");
  const second = await recover(created.id);
  expect(second.stateRevision).toBe(first.stateRevision);
});
it("32MiB exact boundary freezes streamed chunks; +1 is rejected before any excess is written", async () => {
  const chunk = Buffer.alloc(65536, 7),
    hash = createHash("sha256");
  for (let i = 0; i < 512; i++) hash.update(chunk);
  const input = {
    ...expected,
    expectedArchiveBytes: 33554432,
    expectedArchiveSha256: hash.digest("hex"),
  };
  const exact = await create(input);
  const stream = (extra = false): ReceiveSource => ({
    chunks: {
      async *[Symbol.asyncIterator]() {
        for (let i = 0; i < 512; i++) yield chunk;
        if (extra) yield new Uint8Array([1]);
      },
    },
    cancel: async () => {},
  });
  expect((await receive(exact.id, stream())).actualArchiveBytes).toBe(33554432);
  const excess = await create(input);
  await expect(receive(excess.id, stream(true))).rejects.toThrow(
    "RECEIVE_LENGTH_MISMATCH",
  );
  const r = await row(excess.id);
  const { lstat } = await import("node:fs/promises");
  expect(
    (
      await lstat(
        path.join(
          importDirectory(db.config, r.id),
          `attempt-${r.current_attempt_id}.partial`,
        ),
      )
    ).size,
  ).toBe(33554432);
  await recover(r.id);
});
it("no-clobber refuses an existing archive without overwriting; matching fact can be explicitly reconciled", async () => {
  const created = await create();
  await mkdir(importDirectory(db.config, created.id), { mode: 0o700 });
  const archive = path.join(
    importDirectory(db.config, created.id),
    "archive.quizpack",
  );
  await writeFile(archive, payload, { mode: 0o600, flag: "wx" });
  await expect(receive(created.id, source())).rejects.toThrow(
    "RECEIVE_STORAGE_CONFLICT",
  );
  expect((await readFile(archive)).equals(payload)).toBe(true);
  expect((await recover(created.id)).status).toBe("received");
  const wrong = await create();
  await mkdir(importDirectory(db.config, wrong.id), { mode: 0o700 });
  const different = path.join(
    importDirectory(db.config, wrong.id),
    "archive.quizpack",
  );
  await writeFile(different, "untrusted", { mode: 0o600, flag: "wx" });
  await expect(receive(wrong.id, source())).rejects.toThrow(
    "RECEIVE_STORAGE_CONFLICT",
  );
  await expect(recover(wrong.id)).rejects.toThrow("RECEIVE_STORAGE_CONFLICT");
  expect(await readFile(different, "utf8")).toBe("untrusted");
  await unlink(different);
  await recover(wrong.id);
});
it("read-only change, operator disable and Product archive in file stage block completion without auth lock waiting", async () => {
  for (const kind of ["role", "product", "operator"] as const) {
    const created = await create();
    const service = createImportReceiveService({
      afterFreeze: async () => {
        if (kind === "role")
          await safeTestOperation(
            () =>
              db.admin
                .sql`UPDATE qf.operator SET role='read-only' WHERE id=${actor.id}`,
          );
        else if (kind === "operator") {
          const { disableOperator } =
            await import("../../src/lib/db/management");
          await disableOperator(db.config.instanceId, actor.id);
        } else
          await workspaceService.archiveProduct(
            db.app,
            actor.credentials,
            productId,
            { expectedMetadataRevision: 1 },
          );
      },
    });
    await expect(receive(created.id, source(), service)).rejects.toThrow(
      kind === "role"
        ? "CAPABILITY_DENIED"
        : kind === "operator"
          ? "UNAUTHENTICATED"
          : "PRODUCT_ARCHIVED",
    );
    expect((await row(created.id)).status).toBe("receiving");
    if (kind === "role")
      await safeTestOperation(
        () =>
          db.admin
            .sql`UPDATE qf.operator SET role='operator' WHERE id=${actor.id}`,
      );
    else if (kind === "operator") actor = await authenticateTestOperator(db);
    else
      await workspaceService.restoreProduct(
        db.app,
        actor.credentials,
        productId,
        { expectedMetadataRevision: 2 },
      );
    expect((await recover(created.id)).status).toBe("received");
  }
});
it("orphan logical bytes at 512MiB prevent admission, without deleting unknown files", async () => {
  const created = await create(),
    orphan = randomUUID(),
    dir = importDirectory(db.config, orphan);
  await mkdir(dir, { mode: 0o700 });
  const archive = path.join(dir, "archive.quizpack"),
    handle = await open(archive, "wx", 0o600);
  try {
    await handle.truncate(536870912);
  } finally {
    await handle.close();
  }
  try {
    await expect(receive(created.id, source())).rejects.toThrow(
      "RECEIVE_QUOTA_EXCEEDED",
    );
    expect((await row(created.id)).status).toBe("awaiting-upload");
  } finally {
    await unlink(archive);
    await rmdir(dir);
  }
});

it("real lock disconnect during pending read settles source and permits recovery solely via valid receipt", async () => {
  const created = await create(),
    started = deferred();
  let resolveRead!: (value: IteratorResult<Uint8Array>) => void;
  const pending = new Promise<IteratorResult<Uint8Array>>((r) => {
    resolveRead = r;
  });
  const input: ReceiveSource = {
    chunks: {
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            started.resolve();
            return pending;
          },
        };
      },
    },
    cancel: async () => {
      resolveRead({ done: true, value: undefined });
      await pending;
    },
  };
  const attempt = receive(created.id, input).then(
    () => "SUCCESS",
    (e) => (e instanceof Error ? e.message : "FAILED"),
  );
  await started.promise;
  const [storage] = await safeTestOperation(
    () =>
      db.admin.sql<
        { pid: number }[]
      >`SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=72461 AND objid=2 AND objsubid=2 AND granted`,
  );
  await safeTestOperation(
    () => db.app.sql`SELECT pg_terminate_backend(${storage!.pid})`,
  );
  expect(await attempt).toBe("RECEIVE_LOCK_LOST");
  const r = await row(created.id);
  expect(r.status).toBe("receiving");
  expect(Number(r.reserved_bytes)).toBeGreaterThan(0);
  expect(
    (await readdir(importDirectory(db.config, r.id))).some((n) =>
      n.startsWith("stopped-"),
    ),
  ).toBe(true);
  expect((await recover(created.id)).status).toBe("awaiting-upload");
});
it("1024 directory capacity rejects new namespace before claim or body, while exact remaining slot works", async () => {
  const { importsDirectory } =
    await import("../../src/features/quizpack/import/storage");
  const root = importsDirectory(db.config),
    owned: string[] = [];
  const created = await create();
  let consumed = 0;
  const input: ReceiveSource = {
    chunks: {
      async *[Symbol.asyncIterator]() {
        consumed++;
        yield payload;
      },
    },
    cancel: async () => {},
  };
  try {
    for (let i = 0; i < 1024; i++) {
      const dir = path.join(root, randomUUID());
      await mkdir(dir, { mode: 0o700 });
      owned.push(dir);
    }
    await expect(receive(created.id, input)).rejects.toThrow(
      "RECEIVE_SCAN_LIMIT",
    );
    expect(consumed).toBe(0);
    expect((await row(created.id)).attempts.length).toBe(0);
    await rmdir(owned.pop()!);
    expect((await receive(created.id, input)).status).toBe("received");
    expect(consumed).toBe(1);
  } finally {
    for (const dir of owned) await rmdir(dir);
  }
});
it("current directory reserves four names at 12/+1 existing files before touching attempt or body", async () => {
  const created = await create(),
    dir = importDirectory(db.config, created.id),
    owned: string[] = [];
  await mkdir(dir, { mode: 0o700 });
  let consumed = 0;
  const input: ReceiveSource = {
    chunks: {
      async *[Symbol.asyncIterator]() {
        consumed++;
        yield payload;
      },
    },
    cancel: async () => {},
  };
  try {
    for (let i = 0; i < 13; i++) {
      const file = path.join(dir, `attempt-${randomUUID()}.partial`);
      await writeFile(file, "", { mode: 0o600, flag: "wx" });
      owned.push(file);
    }
    await expect(receive(created.id, input)).rejects.toThrow(
      "RECEIVE_SCAN_LIMIT",
    );
    expect(consumed).toBe(0);
    expect((await row(created.id)).attempts.length).toBe(0);
    await unlink(owned.pop()!);
    expect((await receive(created.id, input)).status).toBe("received");
    expect(consumed).toBe(1);
  } finally {
    for (const file of owned) await unlink(file);
  }
});
it("global 8192 entries budget counts three namespace roots and attempt names; +1 admission does not claim", async () => {
  const { importsDirectory, scanStorage } =
    await import("../../src/features/quizpack/import/storage");
  const root = importsDirectory(db.config),
    ownedDirs: string[] = [],
    ownedFiles: string[] = [];
  const created = await create();
  let consumed = 0;
  const input: ReceiveSource = {
    chunks: {
      async *[Symbol.asyncIterator]() {
        consumed++;
        yield payload;
      },
    },
    cancel: async () => {},
  };
  try {
    for (let i = 0; i < 481; i++) {
      const dir = path.join(root, randomUUID());
      await mkdir(dir, { mode: 0o700 });
      ownedDirs.push(dir);
      for (let j = 0; j < 16; j++) {
        const file = path.join(dir, `attempt-${randomUUID()}.partial`);
        await writeFile(file, "", { mode: 0o600, flag: "wx" });
        ownedFiles.push(file);
      }
    }
    const current = importDirectory(db.config, created.id);
    await mkdir(current, { mode: 0o700 });
    // 3 namespace roots + 481*(1 directory + 16 files) + current
    // directory + 8 files = 8189. Four new receive names would reach 8193.
    for (let j = 0; j < 8; j++) {
      const file = path.join(current, `attempt-${randomUUID()}.partial`);
      await writeFile(file, "", { mode: 0o600, flag: "wx" });
      ownedFiles.push(file);
    }
    const entries = async () => {
      const { context, dispose } = createReceiveContext(
        new AbortController().signal,
      );
      try {
        return (await scanStorage(db.config, context)).entries;
      } finally {
        dispose();
      }
    };
    expect(await entries()).toBe(8189);
    await expect(receive(created.id, input)).rejects.toThrow(
      "RECEIVE_SCAN_LIMIT",
    );
    expect(consumed).toBe(0);
    expect((await row(created.id)).attempts.length).toBe(0);
    await unlink(ownedFiles.pop()!);
    expect(await entries()).toBe(8188);
    expect((await receive(created.id, input)).status).toBe("received");
    expect(consumed).toBe(1);
  } finally {
    for (const file of ownedFiles) await unlink(file);
    for (const dir of ownedDirs) await rmdir(dir);
  }
}, 30000);
it("explicit stopped recovery reduces held headroom at exact receive admission quota, without a quota deadlock", async () => {
  const { attemptReservation } =
    await import("../../src/features/quizpack/import/limits");
  const bytes = Buffer.alloc(1048576, 9),
    created = await create({
      ...expected,
      expectedArchiveBytes: bytes.length,
      expectedArchiveSha256: createHash("sha256").update(bytes).digest("hex"),
    });
  const orphan = randomUUID(),
    dir = importDirectory(db.config, orphan);
  await mkdir(dir, { mode: 0o700 });
  const file = path.join(dir, "archive.quizpack"),
    handle = await open(file, "wx", 0o600);
  try {
    await handle.truncate(536870912 - attemptReservation(bytes.length));
  } finally {
    await handle.close();
  }
  const { StudioError } = await import("../../src/lib/http-security/errors");
  const service = createImportReceiveService({
    afterFreeze: async () => {
      throw new StudioError("WRITE_OUTCOME_UNKNOWN");
    },
  });
  try {
    await expect(receive(created.id, source(bytes), service)).rejects.toThrow(
      "WRITE_OUTCOME_UNKNOWN",
    );
    expect(Number((await row(created.id)).reserved_bytes)).toBe(
      attemptReservation(bytes.length),
    );
    expect((await recover(created.id)).status).toBe("received");
    expect(Number((await row(created.id)).reserved_bytes)).toBe(0);
  } finally {
    await unlink(file);
    await rmdir(dir);
  }
});
