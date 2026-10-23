import "server-only";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import type postgres from "postgres";
import { createDatabase } from "@/lib/db/client";
import { loadManagedInstance, openManagedDatabase } from "@/lib/db/management";
import { instanceDirectory } from "@/features/quizpack/import/storage";
import { StorageLock } from "@/features/quizpack/import/storage-lock";
import {
  RECOVERY_LIMITS,
  RECOVERY_TABLES,
  canonicalRecoveryJson,
  recoverySourceSchema,
} from "./contracts";
import type { WithQuiescentRecoverySnapshot } from "./ports";
import {
  checkRecoveryBudget,
  digestRecoveryHandle,
  assertRecoveryIoKnown,
} from "./files";
import { computeRecoveryCodeIdentity } from "./code-identity";
import {
  readRecoveryDatabaseEvidence,
  setRecoveryRowFormat,
} from "./database-evidence";
import {
  assertRecoveryMaintenanceGuardsAbsent,
  readRecoverySourceStorage,
} from "./source-storage";
import {
  runRecoveryPg,
  assertRecoveryProcessesKnown,
} from "./database-process";
import { RecoveryError } from "./errors";
import { assertRecoveryToc } from "./restore-toc";

const unclosed = new Set<object>();
const notQuiescent = () => new RecoveryError("RECOVERY_SOURCE_NOT_QUIESCENT");
function freezeEvidence<T extends object>(value: T): T {
  for (const child of Object.values(value))
    if (child && typeof child === "object") freezeEvidence(child);
  return Object.freeze(value);
}

export const withQuiescentRecoverySnapshot: WithQuiescentRecoverySnapshot =
  async (input, work) => {
    checkRecoveryBudget(input);
    if (unclosed.size) throw new RecoveryError("RECOVERY_CLOSE_UNPROVEN");
    if (
      !/^[a-f0-9]{32}$/.test(input.instanceId) ||
      !/^[a-f0-9]{64}$/.test(input.codeSha256)
    )
      throw new RecoveryError("RECOVERY_ARGUMENTS_INVALID");
    if (
      (await computeRecoveryCodeIdentity(process.cwd(), input)).codeSha256 !==
      input.codeSha256
    )
      throw new RecoveryError("RECOVERY_CODE_MISMATCH");
    if (
      !(await runRecoveryPg("pg_dump", ["--version"], input)).includes(" 18.4 ")
    )
      throw new RecoveryError("RECOVERY_ENVIRONMENT_UNSUPPORTED");
    const managed = await loadManagedInstance(input.instanceId);
    if (
      !["test", "demo"].includes(managed.config.purpose) ||
      managed.config.imports.enabled
    )
      throw notQuiescent();
    await assertRecoveryMaintenanceGuardsAbsent(
      instanceDirectory(managed.config),
    );
    const origin = createServer((socket) => socket.destroy());
    try {
      await new Promise<void>((resolve, reject) => {
        origin.once("error", () => reject(notQuiescent()));
        origin.listen(
          {
            host: "127.0.0.1",
            port: Number(new URL(managed.config.origin).port),
            exclusive: true,
          },
          resolve,
        );
      });
    } catch (error) {
      throw error;
    }
    let db: Awaited<ReturnType<typeof openManagedDatabase>> | undefined;
    let connection: postgres.ReservedSql | undefined,
      storage: StorageLock | undefined;
    let transaction = false,
      migration = false,
      valid = true,
      active = true,
      busyDump = false;
    let abortClose: Promise<unknown> | undefined;
    const applicationName = `qf-recovery-${randomUUID()}`;
    const revoke = () => {
      valid = false;
      if (db)
        abortClose ??= db.close().catch(() => {
          if (db) unclosed.add(db);
        });
    };
    const timer = setTimeout(
      revoke,
      Math.max(1, input.deadlineMonotonicMs - performance.now()),
    );
    input.signal.addEventListener("abort", revoke, { once: true });
    let heartbeat: ReturnType<typeof setInterval> | undefined,
      checking: Promise<void> | undefined;
    let leaseOpen = true,
      issuedError: unknown;
    const issued: Promise<unknown>[] = [];
    const track = <T>(work: () => Promise<T>): Promise<T> => {
      if (!leaseOpen)
        return Promise.reject(new RecoveryError("RECOVERY_LOCK_LOST"));
      const pending = work();
      issued.push(
        pending.then(undefined, (error: unknown) => {
          issuedError ??= error;
        }),
      );
      return pending;
    };
    try {
      db = await openManagedDatabase(input.instanceId);
      connection = await db.sql.reserve();
      await connection.unsafe("SET statement_timeout='2s'");
      const [lock] = await connection<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_lock(716238419221::bigint) locked`;
      if (!lock?.locked) throw notQuiescent();
      migration = true;
      storage = await StorageLock.acquire(managed.config);
      const [storagePid] = await storage.connection<
        { pid: number }[]
      >`SELECT pg_backend_pid() pid`;
      if (!storagePid) throw notQuiescent();
      await connection.unsafe(
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      transaction = true;
      // LOCK is deliberately the first operation after BEGIN: no SELECT may freeze an older RR view.
      await connection.unsafe(
        `LOCK TABLE ${RECOVERY_TABLES.join(",")} IN SHARE MODE NOWAIT`,
      );
      await setRecoveryRowFormat(connection);
      const assertValid = async () => {
        checkRecoveryBudget(input);
        assertRecoveryProcessesKnown();
        if (!valid || !active) throw new RecoveryError("RECOVERY_LOCK_LOST");
        await storage!.check();
        const current = await loadManagedInstance(input.instanceId);
        if (JSON.stringify(current) !== JSON.stringify(managed))
          throw notQuiescent();
        await assertRecoveryMaintenanceGuardsAbsent(
          instanceDirectory(managed.config),
        );
        await connection!`SELECT pg_stat_clear_snapshot()`;
        const [facts] = await connection!<
          { table_locks: number; migration: boolean; others: boolean }[]
        >`
        SELECT (SELECT count(*)::int FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='relation' AND mode='ShareLock' AND granted AND relation::regclass::text=ANY(${[...RECOVERY_TABLES]})) table_locks,
        EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=(716238419221::bigint>>32)::oid AND objid=(716238419221::bigint&4294967295)::oid AND objsubid=1 AND mode='ExclusiveLock' AND granted) migration,
        EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid() AND pid<>${storagePid.pid} AND NOT (${busyDump} AND usename=${managed.admin.owner.user} AND application_name=${applicationName})) others`;
        if (
          facts?.table_locks !== RECOVERY_TABLES.length ||
          !facts.migration ||
          facts.others
        )
          throw notQuiescent();
      };
      await assertValid();
      // Validate unchanged production schema/ACL as the application role, then prove its own backend leaves.
      const app = await createDatabase(managed.config);
      let appPid = 0;
      try {
        const [row] = await app.sql<
          { pid: number }[]
        >`SELECT pg_backend_pid() pid`;
        appPid = row?.pid ?? 0;
      } finally {
        try {
          await app.close();
        } catch {
          unclosed.add(app);
          throw new RecoveryError("RECOVERY_CLOSE_UNPROVEN");
        }
      }
      const exited = performance.now() + 2000;
      while (appPid) {
        await connection`SELECT pg_stat_clear_snapshot()`;
        const [row] = await connection<
          { present: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=${appPid}) present`;
        if (row?.present === false) break;
        if (performance.now() >= exited) throw notQuiescent();
        await delay(10);
      }
      await assertValid();
      const database = await readRecoveryDatabaseEvidence(connection, input);
      const files = await readRecoverySourceStorage(
        managed.config,
        connection,
        input,
      );
      const [snapshot] = await connection<
        { snapshot: string }[]
      >`SELECT pg_export_snapshot() snapshot`;
      if (!snapshot?.snapshot)
        throw new RecoveryError("RECOVERY_SOURCE_INVALID");
      const source = recoverySourceSchema.parse({
        instanceId: input.instanceId,
        purpose: managed.config.purpose,
        root: process.cwd(),
        origin: managed.config.origin,
        pgPort: managed.config.database.port,
        postgresVersion: 180004,
        importsEnabled: false,
        codeSha256: input.codeSha256,
      });
      heartbeat = setInterval(() => {
        if (checking) return;
        checking = assertValid()
          .catch(() => {
            valid = false;
          })
          .finally(() => {
            checking = undefined;
          });
      }, 1000);
      let dumped = false;
      const result = await work(
        Object.freeze({
          source: freezeEvidence(source),
          database: freezeEvidence(database),
          storage: freezeEvidence(files),
          instanceDirectory: instanceDirectory(managed.config),
          assertValid: () => track(assertValid),
          dumpTo: (file) =>
            track(async () => {
              await assertValid();
              if (dumped || busyDump)
                throw new RecoveryError("RECOVERY_ARGUMENTS_INVALID");
              const stat = await file.stat();
              if (
                !stat.isFile() ||
                stat.size !== 0 ||
                stat.nlink !== 1 ||
                stat.uid !== process.getuid?.() ||
                (stat.mode & 0o7777) !== 0o600
              )
                throw new RecoveryError("RECOVERY_STORAGE_INVALID");
              busyDump = true;
              try {
                await runRecoveryPg(
                  "pg_dump",
                  [
                    "-Fc",
                    `--snapshot=${snapshot.snapshot}`,
                    "--host=127.0.0.1",
                    `--port=${managed.config.database.port}`,
                    `--username=${managed.admin.owner.user}`,
                    `--dbname=${managed.admin.owner.name}`,
                    "--no-password",
                  ],
                  input,
                  {
                    env: {
                      PGPASSWORD: managed.admin.owner.password,
                      PGAPPNAME: applicationName,
                    },
                    output: file,
                  },
                );
                // Client close is not server-backend exit: retain this owned dump admission until observed absent.
                const backendDeadline = performance.now() + 2000;
                for (;;) {
                  await connection!`SELECT pg_stat_clear_snapshot()`;
                  const [row] = await connection!<
                    { present: boolean }[]
                  >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND usename=${managed.admin.owner.user} AND application_name=${applicationName}) present`;
                  if (row?.present === false) break;
                  if (performance.now() >= backendDeadline)
                    throw notQuiescent();
                  await delay(10);
                }
                await file.sync();
                const digest = await digestRecoveryHandle(
                  file,
                  input,
                  RECOVERY_LIMITS.dumpBytes,
                  Buffer.from("PGDMP"),
                );
                assertRecoveryToc(
                  await runRecoveryPg("pg_restore", ["--list"], input, {
                    input: file,
                  }),
                  input.instanceId,
                );
                dumped = true;
                return digest;
              } finally {
                busyDump = false;
              }
            }),
        }),
      );
      leaseOpen = false;
      await Promise.all(issued);
      if (issuedError) throw issuedError;
      await checking;
      await assertValid();
      if (
        !dumped ||
        canonicalRecoveryJson(
          await readRecoverySourceStorage(managed.config, connection, input),
        ) !== canonicalRecoveryJson(files)
      )
        throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
      if (
        (await computeRecoveryCodeIdentity(process.cwd(), input)).codeSha256 !==
        input.codeSha256
      )
        throw new RecoveryError("RECOVERY_CODE_MISMATCH");
      return result;
    } finally {
      leaseOpen = false;
      active = false;
      clearInterval(heartbeat);
      clearTimeout(timer);
      input.signal.removeEventListener("abort", revoke);
      await checking;
      await Promise.all(issued);
      const closes: Promise<unknown>[] = [];
      if (connection)
        closes.push(
          (async () => {
            try {
              if (transaction) await connection!.unsafe("ROLLBACK");
              if (migration)
                await connection!`SELECT pg_advisory_unlock(716238419221::bigint)`;
            } finally {
              connection!.release();
            }
          })(),
        );
      const first = await Promise.allSettled(closes);
      if (storage) {
        try {
          if (!(await storage.close())) unclosed.add(storage);
        } catch {
          unclosed.add(storage);
        }
      }
      if (db) {
        try {
          await db.close();
        } catch {
          unclosed.add(db);
        }
      }
      await abortClose;
      await new Promise<void>((resolve, reject) =>
        origin.close((error) => (error ? reject(error) : resolve())),
      );
      assertRecoveryIoKnown();
      assertRecoveryProcessesKnown();
      if (first.some((item) => item.status === "rejected") || unclosed.size)
        throw new RecoveryError("RECOVERY_CLOSE_UNPROVEN");
    }
  };
