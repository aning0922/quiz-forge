import assert from "node:assert/strict";
import fs, { type FileHandle } from "node:fs/promises";
import { constants } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import type postgres from "postgres";
import { z } from "zod";
import { createDatabase } from "@/lib/db/client";
import { instanceDirectory } from "@/features/quizpack/import/storage";
import { openTestDatabase, type TestDatabase } from "../db/p2a-fixture";
import {
  cleanupConsumerFixture,
  readConsumerFixture,
  finishConsumerFixture,
  prepareConsumerFixture,
} from "../db/p4-consumer-fixture";
import { CONSUMER_FIXTURE_PRIVATE_NAME } from "../db/p4-consumer-fixture-contract";
import {
  launchOwnedPreviewNodeProcess,
  stopAndProveServerExit,
} from "./p3c-server-owner";

const [runId] = process.argv.slice(2);
z.uuid().parse(runId);
const db = await openTestDatabase(),
  file = path.join(instanceDirectory(db.config), CONSUMER_FIXTURE_PRIVATE_NAME),
  fixture = await readConsumerFixture(db, runId!);
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      if (!a || typeof a === "string") return reject(Error("P4_PORT_REQUIRED"));
      s.close((e) => (e ? reject(e) : resolve(a.port)));
    });
  });
let deletes = 0,
  opens = 0;
function instrument(sql: postgres.Sql): postgres.Sql {
  return new Proxy(sql, {
    apply(target, thisArg, args) {
      if (
        Array.isArray(args[0]) &&
        args[0].some(
          (s: unknown) => typeof s === "string" && /\bDELETE\b/.test(s),
        )
      ) {
        deletes++;
        throw Error("P4_BEFORE_FIRST_DELETE");
      }
      return Reflect.apply(target, thisArg, args);
    },
    get(target, property, receiver) {
      if (property === "begin")
        return (...args: unknown[]) => {
          const callback = args.at(-1) as (
            tx: postgres.TransactionSql,
          ) => Promise<unknown>;
          return Reflect.apply(target.begin, target, [
            ...args.slice(0, -1),
            (tx: postgres.TransactionSql) =>
              callback(
                instrument(
                  tx as unknown as postgres.Sql,
                ) as unknown as postgres.TransactionSql,
              ),
          ]);
        };
      return Reflect.get(target, property, receiver);
    },
  });
}
const guarded = {
  ...db,
  admin: { ...db.admin, sql: instrument(db.admin.sql) },
} as TestDatabase;
const nativeOpen = fs.open;
let held: FileHandle | undefined,
  nativeClose: (() => Promise<void>) | undefined;
let foreign: Awaited<ReturnType<typeof createDatabase>> | undefined;
try {
  const server = await launchOwnedPreviewNodeProcess(
      {
        cwd: process.cwd(),
        instanceId: db.config.instanceId,
        runId: runId!,
        port: await freePort(),
        runtimeConfigPath: process.env.QUIZFORGE_P2A_CONFIG!,
      },
      ["-e", "setInterval(()=>{},1000)"],
    ),
    proof = await stopAndProveServerExit(server);
  foreign = await createDatabase(db.config);
  const connection = await foreign.sql.reserve();
  try {
    const [pid] = await connection<
      { pid: number }[]
    >`SELECT pg_backend_pid() AS pid`;
    assert(pid);
    const [visible] = await db.admin.sql<
      { backend_type: string | null; state: string | null }[]
    >`SELECT backend_type,state FROM pg_stat_activity WHERE pid=${pid.pid}`;
    assert(visible);
    assert.equal(visible.backend_type, null);
    assert.equal(visible.state, null);
    await assert.rejects(() => cleanupConsumerFixture(guarded, runId!, proof), {
      message: "CONSUMER_FIXTURE_UNKNOWN_PRESERVED",
    });
    const [still] = await connection<
      { pid: number }[]
    >`SELECT pg_backend_pid() AS pid`;
    assert.equal(still?.pid, pid.pid);
    assert.equal(deletes, 0);
  } finally {
    connection.release();
    await foreign.close();
    foreign = undefined;
  }
  fs.open = async (...args: Parameters<typeof fs.open>) => {
    const h = await nativeOpen(...args);
    if (
      String(args[0]) === file &&
      args[1] === (constants.O_RDONLY | constants.O_NOFOLLOW)
    ) {
      opens++;
      held = h;
      nativeClose = h.close.bind(h);
      h.close = async () => {
        throw Error("P4_INJECTED_MANIFEST_CLOSE");
      };
    }
    return h;
  };
  syncBuiltinESMExports();
  await assert.rejects(() => cleanupConsumerFixture(guarded, runId!, proof), {
    message: "P4_INJECTED_MANIFEST_CLOSE",
  });
  assert(held && held.fd >= 0);
  assert.equal(opens, 1);
  assert.equal(deletes, 0);
  for (const operation of [
    () => cleanupConsumerFixture(guarded, runId!, proof),
    () => readConsumerFixture(guarded, runId!),
    () => finishConsumerFixture(guarded, runId!, fixture.observations!),
    () => prepareConsumerFixture(guarded, runId!),
  ])
    await assert.rejects(operation, {
      message: "CONSUMER_FIXTURE_UNKNOWN_PRESERVED",
    });
  assert.equal(opens, 1);
  assert.equal(deletes, 0);
  await nativeClose!();
  assert.equal(held.fd, -1);
  await assert.rejects(() => cleanupConsumerFixture(guarded, runId!, proof), {
    message: "CONSUMER_FIXTURE_UNKNOWN_PRESERVED",
  });
  const reloadPath = "../db/p4-consumer-fixture-owner.ts?actual-reload=1";
  const reloaded = await import(reloadPath);
  assert.throws(() => reloaded.assertConsumerFixtureKnown(), {
    message: "CONSUMER_FIXTURE_UNKNOWN_PRESERVED",
  });
  assert.equal(opens, 1);
  assert.equal(deletes, 0);
  process.stdout.write(
    JSON.stringify({
      passed: true,
      foreignBackendBlocked: true,
      actualFdRejected: true,
      opens,
      deletes,
      lateCloseStillBlocked: true,
      moduleReloadStillBlocked: true,
    }) + "\n",
  );
} finally {
  fs.open = nativeOpen;
  syncBuiltinESMExports();
  if (held && held.fd >= 0 && nativeClose) await nativeClose();
  if (foreign) await foreign.close();
  await db.close();
}
