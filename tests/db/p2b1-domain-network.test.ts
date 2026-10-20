import net from "node:net";
import postgres from "postgres";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import {
  openTestDatabase,
  resetTestDatabase,
  authenticateTestOperator,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
import { openSql, verifyDatabaseIdentity } from "@/lib/db/client";
import { StudioError } from "@/lib/http-security/errors";
import { withStudioWrite } from "@/lib/auth/write";
let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await safe(openTestDatabase);
});
beforeEach(async () => {
  await safe(() => resetTestDatabase(fixture));
});
afterAll(async () => {
  await fixture?.close();
});
async function rejection(work: PromiseLike<unknown>) {
  try {
    await work;
    return { code: null, invalidated: false };
  } catch (error) {
    const fault = error as {
      code?: unknown;
      quizforgeConnectionInvalidated?: unknown;
    };
    return {
      code: typeof fault.code === "string" ? fault.code : null,
      invalidated: fault.quizforgeConnectionInvalidated === true,
    };
  }
}
const cases = [
  { phase: "work", code: "ECONNRESET" },
  { phase: "work", code: "EPIPE" },
  { phase: "work", code: "ETIMEDOUT" },
  { phase: "start", code: "ECONNRESET" },
  { phase: "touch", code: "ECONNRESET" },
  { phase: "commit", code: "ECONNRESET" },
  { phase: "rollback", code: "ECONNRESET" },
] as const;
describe("B1 socket error classification with invalidated driver handles", () => {
  it.each(cases)(
    "$phase $code is unknown without client shutdown or replay",
    async ({ phase, code }) => {
      const auth = await authenticateTestOperator(fixture);
      const template = openSql(fixture.config.database, 1);
      let socket: net.Socket | undefined,
        armed = false,
        injected = false,
        workCalls = 0;
      let stale: postgres.TransactionSql | undefined;
      const inject = () => {
        if (!injected) {
          injected = true;
          socket?.destroy(
            Object.assign(new Error("Synthetic socket fault"), { code }),
          );
        }
      };
      const options = {
        ...template.options,
        idle_timeout: 0,
        socket: async () => {
          const connection = net.createConnection({
            host: fixture.config.database.host,
            port: fixture.config.database.port,
          });
          await new Promise<void>((resolve, reject) => {
            connection.once("connect", resolve);
            connection.once("error", reject);
          });
          socket = connection;
          return connection;
        },
        debug: (_id: number, query: string) => {
          // Inspect only fixed statement shape to place a test fault; never print SQL/parameters.
          if (
            armed &&
            ((phase === "start" &&
              query.startsWith("SET LOCAL lock_timeout")) ||
              (phase === "touch" &&
                query.includes(
                  "UPDATE qf.operator_session s SET last_seen_at = moment.at",
                )) ||
              ((phase === "commit" || phase === "rollback") &&
                query.trim().toLowerCase() === phase))
          )
            inject();
        },
      };
      await template.end({ timeout: 0 });
      const sql = postgres(
        options as unknown as postgres.Options<
          Record<string, postgres.PostgresType>
        >,
      );
      try {
        await safe(() => verifyDatabaseIdentity(sql, fixture.config));
        const proxy = new Proxy(sql, {
          get(target, property, receiver) {
            if (property !== "begin")
              return Reflect.get(target, property, receiver);
            return (
              transactionOptions: string,
              callback: (tx: postgres.TransactionSql) => Promise<unknown>,
            ) =>
              target.begin(transactionOptions, async (tx) => {
                stale = tx;
                return callback(tx);
              });
          },
        });
        armed = true;
        await expect(
          withStudioWrite(
            { ...fixture.app, sql: proxy },
            auth.credentials,
            "workspace:write",
            async (tx) => {
              workCalls++;
              await tx`WITH m AS MATERIALIZED(SELECT clock_timestamp() at) INSERT INTO qf.product(id,slug,title,created_at,updated_at) SELECT 'synthetic','synthetic','Synthetic',at,at FROM m`;
              if (phase === "work") {
                const pending = tx`SELECT pg_sleep(0.2)`.execute();
                await new Promise((resolve) => setTimeout(resolve, 10));
                inject();
                await pending;
              }
              if (phase === "rollback")
                throw new StudioError("TAXONOMY_ARCHIVED");
              return true;
            },
          ),
        ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
        armed = false;
        expect(injected).toBe(true);
        expect(workCalls).toBe(phase === "start" ? 0 : 1);
        expect(await safe(() => sql`SELECT 1`)).toHaveLength(1);
        if (!stale) throw new Error("TEST_TRANSACTION_HANDLE_MISSING");
        expect(
          await rejection(
            stale`INSERT INTO qf.product(id,slug,title,created_at,updated_at) SELECT 'late','late','Late',at,at FROM (SELECT clock_timestamp() at) m`,
          ),
        ).toEqual({ code: "CONNECTION_CLOSED", invalidated: true });
        expect(
          await safe(() => fixture.app.sql`SELECT id FROM qf.product`),
        ).toHaveLength(0);
      } finally {
        await sql.end({ timeout: 0 });
      }
    },
  );
});
