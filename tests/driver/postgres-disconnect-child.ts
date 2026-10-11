import { randomBytes } from "node:crypto";
import net from "node:net";
import { createRequire } from "node:module";
import { setTimeout as sleep } from "node:timers/promises";
import esmPostgres from "postgres";
import { openSql, verifyDatabaseIdentity } from "../../src/lib/db/client";
import { loadManagedInstance } from "../../src/lib/db/management";

// No uncaughtException/unhandledRejection handler: either event fails this child.
const [entry, scenario] = process.argv.slice(2);
const postgres: typeof esmPostgres =
  entry === "cjs" ? createRequire(import.meta.url)("postgres") : esmPostgres;
function check(value: unknown): asserts value {
  if (!value) throw new Error("DRIVER_ASSERTION_FAILED");
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
async function rejected(work: PromiseLike<unknown>) {
  try {
    await work;
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    check(
      typeof code === "string" &&
        /^(CONNECTION_(CLOSED|DESTROYED|ENDED)|57P01|25P04)$/.test(code),
    );
    return code;
  }
  throw new Error("DRIVER_EXPECTED_REJECTION");
}

async function main() {
  const instance = process.env.QF_DRIVER_TEST_INSTANCE;
  check(instance && (entry === "esm" || entry === "cjs"));
  const { config, admin } = await loadManagedInstance(instance);
  check(config.purpose === "test" || config.purpose === "ci");
  const owner = openSql(admin.owner, 1);
  const controller = openSql(config.database, 1);
  let sql: esmPostgres.Sql | undefined;
  const table = "driver_probe_" + randomBytes(12).toString("hex");
  try {
    await verifyDatabaseIdentity(owner, config, admin.owner.user);
    await owner`CREATE SCHEMA ${owner(table)}`;
    await owner`GRANT USAGE ON SCHEMA ${owner(table)} TO ${owner(config.database.user)}`;
    await owner`CREATE TABLE ${owner(table)}.probe (label text PRIMARY KEY)`;
    await owner`GRANT SELECT, INSERT ON ${owner(table)}.probe TO ${owner(config.database.user)}`;
    // Copy the pinned application options, replacing only the tested constructor
    // and test pipeline/lifetime limits; never rely on inherited PG* defaults.
    const template = openSql(config.database, 1);
    let queryBuilds = 0;
    const options = {
      ...template.options,
      max_pipeline: 1,
      debug: () => {
        queryBuilds++;
      },
      idle_timeout: 0,
      max_lifetime: null,
    };
    await template.end({ timeout: 0 });
    let capturedSocket: net.Socket | undefined;
    if (scenario === "socket-write") {
      Object.assign(options, {
        socket: async () => {
          const socket = net.createConnection({
            host: config.database.host,
            port: config.database.port,
          });
          await new Promise<void>((resolve, reject) => {
            socket.once("connect", resolve);
            socket.once("error", reject);
          });
          capturedSocket = socket;
          return socket;
        },
      });
    }
    // Upstream exposes already-parsed options but its constructor declarations
    // accept only input options. shared preserves this pinned parsed object.
    sql = postgres(
      options as unknown as esmPostgres.Options<
        Record<string, esmPostgres.PostgresType>
      >,
    );
    await verifyDatabaseIdentity(sql, config);
    const client = sql;
    const insert = (
      tx:
        esmPostgres.TransactionSql | esmPostgres.Sql | esmPostgres.ReservedSql,
      label: string,
    ) => tx`INSERT INTO ${tx(table)}.probe (label) VALUES (${label})`;
    const count = async (label: string) => {
      const [row] =
        await owner`SELECT count(*)::int AS n FROM ${owner(table)}.probe WHERE label=${label}`;
      return row?.n;
    };
    const terminate = async (pid: number) => {
      const [row] =
        await controller`SELECT pg_terminate_backend(${pid}) AS terminated`;
      check(row?.terminated === true);
      // Observe real backend disappearance, rather than assuming an error is a kill.
      for (let i = 0; i < 100; i++) {
        const [active] =
          await owner`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=${pid}) AS alive`;
        if (!active?.alive) return;
        await sleep(10);
      }
      throw new Error("DRIVER_BACKEND_STILL_ACTIVE");
    };
    const ready = gate(),
      resume = gate(),
      callbackDone = gate();
    let pid = 0;
    let stale: esmPostgres.TransactionSql | undefined;
    let nestedRejection: Promise<string> | undefined;
    if (scenario?.startsWith("terminate-")) {
      const failed = rejected(
        client.begin(async (tx) => {
          const body = async (tx: esmPostgres.TransactionSql) => {
            stale = tx;
            const [backend] = await tx`SELECT pg_backend_pid() AS pid`;
            pid = backend!.pid as number;
            await insert(tx, "original");
            ready.resolve();
            await resume.promise;
            try {
              if (scenario === "terminate-query")
                await rejected(insert(tx, "late"));
              if (scenario === "terminate-savepoint")
                await rejected(
                  tx.savepoint(async (nested) => {
                    await insert(nested, "late");
                  }),
                );
              if (
                scenario === "terminate-rollback" ||
                scenario === "terminate-nested-rollback"
              )
                throw new Error("SYNTHETIC_CALLBACK_ERROR");
            } finally {
              callbackDone.resolve();
            }
          };
          if (scenario.includes("nested")) {
            const nested = tx.savepoint(body);
            nestedRejection = rejected(nested);
            return nested;
          }
          return body(tx);
        }),
      );
      await ready.promise;
      await terminate(pid);
      await failed;
      // Hold a fresh transaction open on the same max=1 pool connection while
      // the stale callback resumes; a stale COMMIT/ROLLBACK would affect this row.
      const replacementReady = gate(),
        replacementResume = gate();
      const replacement = client
        .begin(async (tx) => {
          await insert(tx, "replacement");
          replacementReady.resolve();
          await replacementResume.promise;
          throw new Error("SYNTHETIC_REPLACEMENT_ROLLBACK");
        })
        .catch((error: unknown) => {
          check(
            error instanceof Error &&
              error.message === "SYNTHETIC_REPLACEMENT_ROLLBACK",
          );
        });
      await replacementReady.promise;
      const buildsBeforeResume = queryBuilds;
      resume.resolve();
      await callbackDone.promise;
      if (nestedRejection) await nestedRejection;
      await sleep(100); // Allow scope's implicit COMMIT/ROLLBACK to settle.
      check(queryBuilds === buildsBeforeResume);
      await rejected(insert(stale!, "escaped"));
      replacementResume.resolve();
      await replacement;
      check((await count("original")) === 0);
      check((await count("late")) === 0);
      check((await count("escaped")) === 0);
      check((await count("replacement")) === 0);
    } else if (scenario === "queued") {
      let outcomes: PromiseSettledResult<unknown>[] = [];
      const failed = rejected(
        client.begin(async (tx) => {
          const [backend] = await tx`SELECT pg_backend_pid() AS pid`;
          pid = backend!.pid as number;
          await insert(tx, "original");
          const work = Promise.allSettled([
            tx`SELECT pg_sleep(3)`.execute(),
            insert(tx, "pipelined").execute(),
            insert(tx, "queued").execute(),
            insert(tx, "queued-again").execute(),
          ]);
          ready.resolve();
          outcomes = await work;
          callbackDone.resolve();
        }),
      );
      await ready.promise;
      await sleep(50);
      await terminate(pid);
      await failed;
      await callbackDone.promise;
      check(
        outcomes.length === 4 && outcomes.every((x) => x.status === "rejected"),
      );
      for (const label of ["original", "pipelined", "queued", "queued-again"])
        check((await count(label)) === 0);
    } else if (scenario === "reserve") {
      const reserved = await client.reserve();
      const [backend] = await reserved`SELECT pg_backend_pid() AS pid`;
      pid = backend!.pid as number;
      const work = Promise.allSettled([
        reserved`SELECT pg_sleep(3)`.execute(),
        insert(reserved, "pipelined").execute(),
        insert(reserved, "queued").execute(),
      ]);
      await sleep(50);
      await terminate(pid);
      check((await work).every((x) => x.status === "rejected"));
      await client`SELECT 1`;
      const replacement = await client.reserve();
      reserved.release(); // Must not release a replacement reservation.
      let pooledSettled = false;
      const pooled = client`SELECT 1`.then(() => {
        pooledSettled = true;
      });
      await sleep(50);
      check(!pooledSettled);
      await replacement`SELECT 1`;
      replacement.release();
      await pooled;
      await rejected(insert(reserved, "late"));
      check(
        (await count("pipelined")) === 0 &&
          (await count("queued")) === 0 &&
          (await count("late")) === 0,
      );
    } else if (scenario === "client-end") {
      const failed = rejected(
        client.begin(async (tx) => {
          await insert(tx, "original");
          ready.resolve();
          await resume.promise;
          await rejected(insert(tx, "late"));
          callbackDone.resolve();
        }),
      );
      await ready.promise;
      await client.end({ timeout: 0 });
      await failed;
      resume.resolve();
      await callbackDone.promise;
      await sleep(100);
      check((await count("original")) === 0 && (await count("late")) === 0);
    } else if (scenario === "timeout-active" || scenario === "timeout-idle") {
      let observedTimeout = false;
      const failed = rejected(
        client.begin(async (tx) => {
          await tx`SET LOCAL statement_timeout = 0`;
          await tx`SET LOCAL transaction_timeout = '150ms'`;
          const [backend] = await tx`SELECT pg_backend_pid() AS pid`;
          pid = backend!.pid as number;
          await insert(tx, "original");
          ready.resolve();
          try {
            if (scenario === "timeout-active") {
              try {
                await tx`SELECT pg_sleep(3)`;
              } catch (error) {
                observedTimeout = (error as { code?: string }).code === "25P04";
                throw error;
              }
            } else {
              await sleep(400);
              await rejected(insert(tx, "late"));
            }
          } finally {
            callbackDone.resolve();
          }
        }),
      );
      await ready.promise;
      const timeoutCode = await failed;
      check(timeoutCode === "25P04");
      await callbackDone.promise;
      await sleep(100);
      const [backend] =
        await owner`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=${pid}) AS alive`;
      check(backend?.alive === false);
      if (scenario === "timeout-active") check(observedTimeout);
      check((await count("original")) === 0 && (await count("late")) === 0);
    } else if (scenario === "socket-write") {
      // The real TCP socket closes between buffered execute() and setImmediate.
      const pending = rejected(insert(client, "buffered").execute());
      await Promise.resolve();
      check(capturedSocket);
      capturedSocket.destroy();
      await pending;
      await sleep(50);
      check((await count("buffered")) === 0);
    } else if (scenario === "graceful-end") {
      const transaction = client.begin(async (tx) => {
        ready.resolve();
        await resume.promise;
        await insert(tx, "graceful");
      });
      await ready.promise;
      const ending = client.end();
      await sleep(25);
      resume.resolve();
      await transaction;
      await ending;
      check((await count("graceful")) === 1);
    } else if (scenario === "cursor") {
      const failed = rejected(
        client.begin(async (tx) => {
          const [backend] = await tx`SELECT pg_backend_pid() AS pid`;
          pid = backend!.pid as number;
          await tx`SELECT generate_series(1,3)`.cursor(1, async () => {
            ready.resolve();
            await resume.promise;
            callbackDone.resolve();
          });
        }),
      );
      await ready.promise;
      await terminate(pid);
      await failed;
      await client.begin(async (tx) => {
        await insert(tx, "cursor-replacement");
        resume.resolve();
        await callbackDone.promise;
        await sleep(100);
        await tx`SELECT 1`;
      });
      check((await count("cursor-replacement")) === 1);
    } else if (scenario === "compatibility") {
      let escaped: esmPostgres.TransactionSql | undefined;
      await client.begin(async (tx) => {
        escaped = tx;
        await insert(tx, "commit");
        await tx.savepoint(async (nested) => {
          await nested.savepoint("nested", async (inner) => {
            await insert(inner, "savepoint");
          });
        });
        try {
          await tx.savepoint(async (nested) => {
            await insert(nested, "rollback-savepoint");
            throw new Error("SYNTHETIC_SAVEPOINT_ROLLBACK");
          });
        } catch (error) {
          check(
            error instanceof Error &&
              error.message === "SYNTHETIC_SAVEPOINT_ROLLBACK",
          );
        }
        await insert(tx, "after-savepoint");
      });
      await rejected(insert(escaped!, "escaped"));
      const r = await client.reserve();
      await insert(r, "reserved");
      r.release();
      r.release();
      await rejected(insert(r, "released"));
      check(
        (await count("commit")) === 1 &&
          (await count("savepoint")) === 1 &&
          (await count("after-savepoint")) === 1 &&
          (await count("reserved")) === 1,
      );
      check(
        (await count("rollback-savepoint")) === 0 &&
          (await count("escaped")) === 0 &&
          (await count("released")) === 0,
      );
    } else throw new Error("DRIVER_SCENARIO_INVALID");
    if (scenario !== "client-end" && scenario !== "graceful-end") {
      await insert(client, "fresh");
      check((await count("fresh")) === 1);
    }
  } finally {
    await sql?.end({ timeout: 0 });
    await owner`DROP SCHEMA IF EXISTS ${owner(table)} CASCADE`;
    await owner.end({ timeout: 0 });
    await controller.end({ timeout: 0 });
  }
}
main()
  .then(() => {
    process.stdout.write("DRIVER_CASE_OK\n");
  })
  .catch(() => {
    process.stderr.write("DRIVER_CASE_FAILED\n");
    process.exitCode = 1;
  });
