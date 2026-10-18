import assert from "node:assert/strict";
import {
  createObservedDatabase,
  type P2aDatabase,
} from "../../src/lib/db/client";
import { loadRuntimeConfig } from "../../src/lib/db/runtime";
import {
  runConsumerSqlPhase,
  type ConsumerSqlFactory,
} from "../../src/features/fulfillment/consumer-flow/sql-owner";
import { ConsumerError } from "../../src/lib/consumer-contract/v1/errors";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const tick = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
async function until(check: () => boolean) {
  const deadline = performance.now() + 4000;
  while (!check()) {
    if (performance.now() >= deadline)
      throw Error("P4_OWNER_CHILD_WAIT_FAILED");
    await new Promise((r) => setTimeout(r, 5));
  }
}
function clock() {
  const controller = new AbortController();
  return {
    controller,
    budget: {
      signal: controller.signal,
      deadlineMonotonicMs: performance.now() + 15000,
    },
  };
}
async function main() {
  const scenario = process.argv[2];
  if (
    !["normal", "late-close", "early-failure", "rejected-close"].includes(
      scenario ?? "",
    )
  )
    throw Error("P4_OWNER_CHILD_CASE_INVALID");
  const config = await loadRuntimeConfig();
  if (!["test", "ci"].includes(config.purpose))
    throw Error("P4_OWNER_CHILD_TEST_REQUIRED");
  const actualClosers: (() => Promise<void>)[] = [];
  const proofs = Array.from({ length: 8 }, deferred);
  let opens = 0,
    endingCalls = 0;
  const factory: ConsumerSqlFactory = (c, b, observer) =>
    createObservedDatabase(c, b, {
      ...observer,
      allocated(client) {
        const index = opens++;
        const nativeEnd = client.end.bind(client);
        let actual: Promise<void> | undefined;
        const realClose = () => (actual ??= nativeEnd({ timeout: 0 }));
        actualClosers.push(realClose);
        // Observe the exact allocated client before any verification promise can settle.
        observer.allocated(client);
        if (scenario === "late-close")
          client.end = () => {
            endingCalls++;
            void realClose().catch(() => {});
            return proofs[index]!.promise;
          };
        if (scenario === "early-failure")
          client.end = () => {
            endingCalls++;
            return proofs[index]!.promise;
          };
        if (scenario === "rejected-close")
          client.end = () => {
            endingCalls++;
            return Promise.reject(new Error("P4_OWNER_SYNTHETIC_END_REJECTED"));
          };
      },
    });
  const normal = () =>
    runConsumerSqlPhase(
      config,
      clock().budget,
      createObservedDatabase,
      async (db) => {
        const [r] = await db.sql<
          { pid: number }[]
        >`SELECT pg_backend_pid() pid`;
        assert.ok(r?.pid && r.pid > 0);
        return "normal";
      },
    );
  try {
    if (scenario === "normal") {
      for (let i = 0; i < 12; i++) assert.equal(await normal(), "normal");
      await assert.rejects(
        runConsumerSqlPhase(
          config,
          clock().budget,
          createObservedDatabase,
          async () => {
            throw new ConsumerError("OUTCOME_UNKNOWN");
          },
        ),
        { code: "OUTCOME_UNKNOWN" },
      );
      assert.equal(await normal(), "normal");
    } else if (scenario === "late-close") {
      const works = Array.from({ length: 8 }, deferred),
        clocks = Array.from({ length: 8 }, clock);
      let started = 0;
      const observed = clocks.map((c, i) =>
        runConsumerSqlPhase(config, c.budget, factory, async (db) => {
          await db.sql`SELECT pg_backend_pid()`;
          started++;
          await works[i]!.promise;
        }).catch((e) => e),
      );
      await until(() => started === 8);
      await assert.rejects(
        runConsumerSqlPhase(config, clock().budget, factory, async () => {}),
        { code: "BUSY" },
      );
      assert.equal(opens, 8);
      clocks.forEach((c) => c.controller.abort());
      const errors = await Promise.all(observed);
      assert.ok(
        errors.every((e) => e instanceof ConsumerError && e.code === "TIMEOUT"),
      );
      await until(() => endingCalls === 8);
      await Promise.all(actualClosers.map((close) => close()));
      proofs[0]!.resolve();
      await tick();
      // Close can be fulfilled while real callback is still pending; it must NOT release a slot.
      await assert.rejects(normal(), { code: "BUSY" });
      works[0]!.resolve();
      await tick();
      assert.equal(await normal(), "normal");
      for (let i = 1; i < 8; i++) {
        works[i]!.resolve();
        proofs[i]!.resolve();
      }
      await tick();
    } else if (scenario === "early-failure") {
      const clocks = Array.from({ length: 8 }, clock);
      // Wrong expected server identity; actual connection parameters still target only this own instance.
      const wrong = {
        ...config,
        purpose: "ci" as const,
        server: {
          ...config.server,
          port: config.server.port === 65535 ? 65534 : config.server.port + 1,
        },
      };
      const observed = clocks.map((c) =>
        runConsumerSqlPhase(wrong, c.budget, factory, async () => {
          throw Error("P4_OWNER_CALLBACK_MUST_NOT_RUN");
        }).catch((e) => e),
      );
      await until(() => endingCalls === 8);
      clocks.forEach((c) => c.controller.abort());
      assert.ok(
        (await Promise.all(observed)).every(
          (e) => e instanceof ConsumerError && e.code === "TIMEOUT",
        ),
      );
      for (let i = 0; i < 100; i++)
        await assert.rejects(normal(), { code: "BUSY" });
      assert.equal(opens, 8);
      await Promise.all(actualClosers.map((close) => close()));
      proofs[0]!.resolve();
      await tick();
      assert.equal(await normal(), "normal");
      for (let i = 1; i < 8; i++) proofs[i]!.resolve();
      await tick();
    } else {
      for (let i = 0; i < 8; i++)
        await assert.rejects(
          runConsumerSqlPhase(
            config,
            clock().budget,
            factory,
            async (db: P2aDatabase) => {
              await db.sql`SELECT pg_backend_pid()`;
            },
          ),
        );
      for (let i = 0; i < 100; i++)
        await assert.rejects(normal(), { code: "BUSY" });
      assert.equal(opens, 8);
      // Actual native ends are cleanup proof, never an instruction to clear the poisoned registry.
      await Promise.all(actualClosers.map((close) => close()));
      await assert.rejects(normal(), { code: "BUSY" });
    }
  } finally {
    await Promise.all(actualClosers.map((close) => close()));
  }
  process.stdout.write("P4_SQL_OWNER_CHILD_OK\n");
}
main().catch(() => {
  // No SQL errors, config, credentials, query text, parameters or arbitrary exceptions reach parent output.
  process.stderr.write("P4_SQL_OWNER_CHILD_FAILED\n");
  process.exitCode = 1;
});
