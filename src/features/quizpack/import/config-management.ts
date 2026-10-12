import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  instancePaths,
  loadManagedInstance,
  openManagedDatabase,
} from "@/lib/db/management";
import { runtimeConfigFile, normalizeRuntimeConfig } from "@/lib/db/runtime";
import { StudioError } from "@/lib/http-security/errors";
import { StorageLock } from "./storage-lock";
import {
  ensureStorage,
  instanceDirectory,
  ownerExited,
  privateFile,
  readBoundedJson,
  removeOwned,
} from "./storage";
const guardSchema = z.strictObject({
  version: z.literal(1),
  instanceId: z.string().regex(/^[a-f0-9]{32}$/),
  ownerPid: z.number().int().min(1).max(2147483647),
  ownerNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
type Guard = { file: string; inode: Stats; data: z.infer<typeof guardSchema> };
export type ConfigManagementIo = {
  rename?: typeof rename;
  beforeGuardUnlink?: () => Promise<void>;
};
async function exists(file: string) {
  try {
    await lstat(file);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
async function readGuard(file: string, id: string): Promise<Guard> {
  try {
    const inode = await lstat(file);
    privateFile(inode);
    const parsed = guardSchema.safeParse(await readBoundedJson(file));
    if (!parsed.success || parsed.data.instanceId !== id)
      throw new Error("GUARD_INVALID");
    return { file, inode, data: parsed.data };
  } catch {
    throw new StudioError("RECEIVE_STORAGE_CONFLICT");
  }
}
async function assertGuard(guard: Guard) {
  const current = await readGuard(guard.file, guard.data.instanceId);
  if (
    current.inode.ino !== guard.inode.ino ||
    current.inode.dev !== guard.inode.dev ||
    JSON.stringify(current.data) !== JSON.stringify(guard.data)
  )
    throw new StudioError("RECEIVE_STORAGE_CONFLICT");
}
async function createGuard(file: string, id: string): Promise<Guard> {
  let handle;
  try {
    handle = await open(
      file,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST")
      throw new StudioError("RECEIVE_BUSY");
    throw new StudioError("RECEIVE_STORAGE_CONFLICT");
  }
  const inode = await handle.stat();
  const data: Guard["data"] = {
    version: 1,
    instanceId: id,
    ownerPid: process.pid,
    ownerNonce: randomBytes(32).toString("base64url"),
  };
  // An incomplete guard remains a maintenance blocker after a failed write/sync/close.
  try {
    await handle.writeFile(JSON.stringify(data));
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { file, inode, data };
}
/** Sole CLI switch. Guards span every issued filesystem operation even if the PG lock dies. */
export async function configureImports(
  instanceId: string,
  enabled: boolean,
  io: ConfigManagementIo = {},
) {
  if (typeof enabled !== "boolean") throw new StudioError("INVALID_REQUEST");
  const managed = await openManagedDatabase(instanceId);
  const root = instanceDirectory(managed.config),
    normal = path.join(root, "imports-config.guard"),
    recovery = path.join(root, "imports-config-recovery.guard");
  let own: Guard | undefined,
    recoveryOwn: Guard | undefined,
    lock: StorageLock | undefined,
    temp: string | undefined,
    tempInode: Stats | undefined;
  let issued = false;
  try {
    await ensureStorage(managed.config);
    if (await exists(recovery)) throw new StudioError("RECEIVE_BUSY");
    if (await exists(normal)) {
      const old = await readGuard(normal, instanceId);
      if (!ownerExited(old.data.ownerPid))
        throw new StudioError("RECEIVE_BUSY");
      recoveryOwn = await createGuard(recovery, instanceId); // before acquiring PG storage lock
      lock = await StorageLock.acquire(managed.config);
      await assertGuard(recoveryOwn);
      await assertGuard(old);
      if (!ownerExited(old.data.ownerPid))
        throw new StudioError("RECEIVE_BUSY");
      await loadManagedInstance(instanceId);
      lock.assert();
      await io.beforeGuardUnlink?.(); // a started unlink must settle while recovery guard remains exclusive
      await removeOwned(old.file, old.inode);
      own = await createGuard(normal, instanceId);
    } else {
      own = await createGuard(normal, instanceId); // before attempting PG storage lock
      if (await exists(recovery)) throw new StudioError("RECEIVE_BUSY");
      lock = await StorageLock.acquire(managed.config);
    }
    await assertGuard(own);
    if (!recoveryOwn && (await exists(recovery)))
      throw new StudioError("RECEIVE_BUSY");
    if (recoveryOwn) await assertGuard(recoveryOwn);
    const current = await loadManagedInstance(instanceId);
    lock.assert();
    const [migration] = await managed.sql<
      { ready: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM qf_meta.schema_migrations WHERE version='0012_validation_file_stop_ack') ready`;
    if (!migration?.ready) throw new StudioError("STUDIO_UNAVAILABLE");
    const [permission] = await managed.sql<{ ready: boolean }[]>`SELECT
      has_table_privilege(${current.config.database.user},'qf.quizpack_import','SELECT')
      AND has_table_privilege(${current.config.database.user},'qf.quizpack_import','INSERT')
      AND has_column_privilege(${current.config.database.user},'qf.quizpack_import','status','UPDATE')
      AND NOT has_table_privilege(${current.config.database.user},'qf.quizpack_import','DELETE')
      AND has_table_privilege(${current.config.database.user},'qf.quizpack_validation','SELECT')
      AND has_table_privilege(${current.config.database.user},'qf.quizpack_validation','INSERT')
      AND has_column_privilege(${current.config.database.user},'qf.quizpack_validation','status','UPDATE')
      AND NOT has_table_privilege(${current.config.database.user},'qf.quizpack_validation','DELETE,TRUNCATE')
      AND has_table_privilege(${current.config.database.user},'qf.asset_blob','SELECT')
      AND has_table_privilege(${current.config.database.user},'qf.asset_blob','INSERT')
      AND NOT has_table_privilege(${current.config.database.user},'qf.asset_blob','UPDATE,DELETE,TRUNCATE')
      AND has_table_privilege(${current.config.database.user},'qf.product_asset','SELECT')
      AND has_table_privilege(${current.config.database.user},'qf.product_asset','INSERT')
      AND NOT has_table_privilege(${current.config.database.user},'qf.product_asset','UPDATE,DELETE,TRUNCATE') ready`;
    if (!permission?.ready) throw new StudioError("STUDIO_UNAVAILABLE");
    const config = normalizeRuntimeConfig({
      ...runtimeConfigFile(current.config),
      version: 2,
      imports: { enabled },
    });
    temp = path.join(root, `runtime.json.tmp-${randomUUID()}`);
    const handle = await open(
      temp,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    tempInode = await handle.stat();
    try {
      await handle.writeFile(
        JSON.stringify(runtimeConfigFile(config), null, 2) + "\n",
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    await lock.check();
    await assertGuard(own);
    if (!recoveryOwn && (await exists(recovery)))
      throw new StudioError("RECEIVE_BUSY");
    issued = true;
    await (io.rename ?? rename)(temp, instancePaths(instanceId).runtime);
    temp = undefined;
    await lock.check();
    const confirmed = await loadManagedInstance(instanceId);
    if (
      confirmed.config.version !== 2 ||
      confirmed.config.imports.enabled !== enabled
    )
      throw new StudioError("WRITE_OUTCOME_UNKNOWN");
    return { enabled };
  } catch (e) {
    // Re-read for integrity, but no claim of rollback or replay of an old target after unknown IO.
    if (issued) {
      await loadManagedInstance(instanceId).catch(() => {});
      throw new StudioError("WRITE_OUTCOME_UNKNOWN");
    }
    if (e instanceof StudioError) throw e;
    throw new StudioError("RECEIVE_STORAGE_CONFLICT");
  } finally {
    // All writes/syncs/renames/closes above have actually settled before any inode-specific unlink.
    if (temp && tempInode) await removeOwned(temp, tempInode).catch(() => {});
    if (own) await removeOwned(own.file, own.inode).catch(() => {});
    if (recoveryOwn)
      await removeOwned(recoveryOwn.file, recoveryOwn.inode).catch(() => {});
    await lock?.close();
    await managed.close();
  }
}
