import { randomBytes } from "node:crypto";
import { lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import {
  openTestDatabase,
  resetTestDatabase,
  safeTestOperation,
  type TestDatabase,
} from "./p2a-fixture";
import { configureImports } from "../../src/features/quizpack/import/config-management";
import {
  instanceDirectory,
  ownerExited,
} from "../../src/features/quizpack/import/storage";
import { loadManagedInstance } from "../../src/lib/db/management";
let db: TestDatabase;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const guard = (pid: number) => ({
  version: 1,
  instanceId: db.config.instanceId,
  ownerPid: pid,
  ownerNonce: randomBytes(32).toString("base64url"),
});
const file = (name: string) => path.join(instanceDirectory(db.config), name);
async function present(name: string) {
  try {
    await lstat(file(name));
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
async function killStorage() {
  const [row] = await safeTestOperation(
    () =>
      db.admin.sql<
        { pid: number }[]
      >`SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=72461 AND objid=2 AND objsubid=2 AND granted`,
  );
  if (!row) throw new Error("TEST_LOCK_REQUIRED");
  await safeTestOperation(
    () => db.app.sql`SELECT pg_terminate_backend(${row.pid})`,
  );
}
async function deadChild() {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
    stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", () => reject(new Error("TEST_CHILD_FAILED")));
    child.once("exit", () => resolve());
  });
  if (!child.pid) throw new Error("TEST_CHILD_REQUIRED");
  return child.pid;
}
beforeAll(async () => {
  db = await openTestDatabase();
});
beforeEach(async () => {
  await resetTestDatabase(db);
  await configureImports(db.config.instanceId, false);
});
afterAll(async () => {
  await configureImports(db.config.instanceId, false);
  await resetTestDatabase(db);
  await db.close();
});
it("old v1 remains a strict disabled file; sole CLI path explicitly upgrades without credential rotation", async () => {
  const runtime = file("runtime.json");
  const original = JSON.parse(await readFile(runtime, "utf8")) as Record<
    string,
    unknown
  >;
  const { imports: _imports, ...rest } = original;
  void _imports;
  await writeFile(runtime, JSON.stringify({ ...rest, version: 1 }), {
    mode: 0o600,
  });
  expect(
    (await loadManagedInstance(db.config.instanceId)).config.imports.enabled,
  ).toBe(false);
  await configureImports(db.config.instanceId, true);
  const updated = JSON.parse(await readFile(runtime, "utf8")) as Record<
    string,
    unknown
  >;
  expect(updated.version).toBe(2);
  expect(updated.imports).toEqual({ enabled: true });
  expect(
    JSON.stringify(updated.database) === JSON.stringify(original.database),
  ).toBe(true);
  expect((await lstat(runtime)).mode & 0o777).toBe(0o600);
});
it("ordinary guard blocks second CLI until a late rename actually settles after storage connection loss", async () => {
  const entered = deferred(),
    release = deferred();
  const first = configureImports(db.config.instanceId, true, {
    rename: async (from, to) => {
      entered.resolve();
      await release.promise;
      await rename(from, to);
    },
  });
  const result = first.then(
    () => "SUCCESS",
    (e) => (e instanceof Error ? e.message : "FAILED"),
  );
  await entered.promise;
  expect(await present("imports-config.guard")).toBe(true);
  await killStorage();
  await expect(configureImports(db.config.instanceId, false)).rejects.toThrow(
    "RECEIVE_BUSY",
  );
  release.resolve();
  expect(await result).toBe("WRITE_OUTCOME_UNKNOWN");
  expect(
    (await loadManagedInstance(db.config.instanceId)).config.imports.enabled,
  ).toBe(true);
  expect(await present("imports-config.guard")).toBe(false);
  await configureImports(db.config.instanceId, false);
  expect(
    (await loadManagedInstance(db.config.instanceId)).config.imports.enabled,
  ).toBe(false);
});
it("recovery guard prevents late old-guard unlink from racing a successor after actual lock loss", async () => {
  const dead = await deadChild();
  expect(ownerExited(dead)).toBe(true);
  await writeFile(file("imports-config.guard"), JSON.stringify(guard(dead)), {
    mode: 0o600,
    flag: "wx",
  });
  const entered = deferred(),
    release = deferred();
  const first = configureImports(db.config.instanceId, true, {
    beforeGuardUnlink: async () => {
      entered.resolve();
      await release.promise;
    },
  });
  const result = first.then(
    () => "SUCCESS",
    (e) => (e instanceof Error ? e.message : "FAILED"),
  );
  await entered.promise;
  expect(await present("imports-config-recovery.guard")).toBe(true);
  await killStorage();
  await expect(configureImports(db.config.instanceId, false)).rejects.toThrow(
    "RECEIVE_BUSY",
  );
  release.resolve();
  expect(await result).toBe("RECEIVE_LOCK_LOST");
  expect(await present("imports-config-recovery.guard")).toBe(false);
  expect(await present("imports-config.guard")).toBe(false);
  await configureImports(db.config.instanceId, false);
});
it("alive owner, damaged/oversize/symlink guard and residual recovery guard are retained", async () => {
  const normal = file("imports-config.guard");
  await writeFile(normal, JSON.stringify(guard(process.pid)), {
    flag: "wx",
    mode: 0o600,
  });
  await expect(configureImports(db.config.instanceId, true)).rejects.toThrow(
    "RECEIVE_BUSY",
  );
  expect(await present("imports-config.guard")).toBe(true);
  await unlink(normal);
  for (const body of ["{", " ".repeat(2049)]) {
    await writeFile(normal, body, { mode: 0o600, flag: "wx" });
    await expect(configureImports(db.config.instanceId, true)).rejects.toThrow(
      "RECEIVE_STORAGE_CONFLICT",
    );
    expect(await present("imports-config.guard")).toBe(true);
    await unlink(normal);
  }
  const { symlink } = await import("node:fs/promises");
  await symlink(file("runtime.json"), normal);
  await expect(configureImports(db.config.instanceId, true)).rejects.toThrow(
    "RECEIVE_STORAGE_CONFLICT",
  );
  await unlink(normal);
  await writeFile(
    file("imports-config-recovery.guard"),
    JSON.stringify(guard(await deadChild())),
    { mode: 0o600, flag: "wx" },
  );
  await expect(configureImports(db.config.instanceId, true)).rejects.toThrow(
    "RECEIVE_BUSY",
  );
  expect(await present("imports-config-recovery.guard")).toBe(true);
  await unlink(file("imports-config-recovery.guard"));
});
it("failed atomic replacement leaves valid prior config and exposes only fixed unknown outcome", async () => {
  await expect(
    configureImports(db.config.instanceId, true, {
      rename: async () => {
        throw Object.assign(new Error("IO_FAILED"), { code: "EIO" });
      },
    }),
  ).rejects.toThrow("WRITE_OUTCOME_UNKNOWN");
  expect(
    (await loadManagedInstance(db.config.instanceId)).config.imports.enabled,
  ).toBe(false);
  expect(await present("imports-config.guard")).toBe(false);
});
