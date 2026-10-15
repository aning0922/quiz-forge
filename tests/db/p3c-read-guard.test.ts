import { afterAll, beforeAll, expect, it } from "vitest";
import { StorageReadGuard } from "@/features/quizpack/resource-read/guard";
import { StorageLock } from "@/features/quizpack/import/storage-lock";
import {
  openTestDatabase,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
let db: TestDatabase;
beforeAll(async () => {
  db = await openTestDatabase();
});
afterAll(async () => {
  await db?.close();
});
const acquire = () =>
  StorageReadGuard.acquire(db.config, () => {}, performance.now() + 15000);
it("actual session shared locks coexist and block existing exclusive storage maintenance", async () => {
  const one = await acquire(),
    two = await acquire();
  try {
    await one.check();
    await two.check();
    const [row] = await safe(
      () =>
        db.admin.sql<
          { count: number }[]
        >`SELECT count(*)::int count FROM pg_locks WHERE locktype='advisory' AND classid=72461 AND objid=2 AND objsubid=2 AND mode='ShareLock' AND granted`,
    );
    expect(row?.count).toBe(2);
    await expect(StorageLock.acquire(db.config)).rejects.toMatchObject({
      code: "RECEIVE_BUSY",
    });
  } finally {
    await one.close();
    await two.close();
  }
  const exclusive = await StorageLock.acquire(db.config);
  await exclusive.close();
});
it("existing exclusive maintenance rejects new reader, then real release admits it", async () => {
  const lock = await StorageLock.acquire(db.config);
  try {
    await expect(acquire()).rejects.toMatchObject({ code: "PREVIEW_BUSY" });
  } finally {
    await lock.close();
  }
  const reader = await acquire();
  await reader.check();
  await reader.close();
});
it("actual backend termination invalidates guard and never certifies filesystem stop", async () => {
  const reader = await acquire();
  try {
    await safe(
      () =>
        db.app
          .sql`SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype='advisory' AND classid=72461 AND objid=2 AND objsubid=2 AND mode='ShareLock' AND granted`,
    );
    await expect(reader.check()).rejects.toBeDefined();
    expect(reader.signal.aborted).toBe(true);
    expect(() => reader.assert()).toThrow("PREVIEW_RESOURCE_UNAVAILABLE");
  } finally {
    await reader.close();
  }
});
