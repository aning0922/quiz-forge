import { expect, it, vi } from "vitest";
import type { P2aDatabase, DatabaseBudget } from "@/lib/db/client";
import type { P2aRuntimeConfig } from "@/lib/db/runtime";
import type { DatabaseLifecycleObserver } from "@/lib/db/lifecycle-observer";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import { runConsumerSqlPhase, type ConsumerSqlFactory } from "./sql-owner";
// These tests allocate no real pools/sockets; permanent-close faults remain in this isolated test worker.
const config = {} as P2aRuntimeConfig;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function clock() {
  const controller = new AbortController();
  const budget: DatabaseBudget = {
    signal: controller.signal,
    deadlineMonotonicMs: performance.now() + 15000,
  };
  return { controller, budget };
}
const tick = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
function database(
  observer: DatabaseLifecycleObserver,
  closing: Promise<void> = Promise.resolve(),
) {
  const sql = {} as P2aDatabase["sql"];
  observer.allocated(sql);
  observer.verification(Promise.resolve());
  let latch: Promise<void> | undefined;
  return {
    sql,
    close: () => {
      if (!latch) {
        latch = closing;
        observer.ending(latch);
      }
      return latch;
    },
  } as P2aDatabase;
}
it("reserves eight synchronously, keeps aborted/pending work and closes occupied, and shares the gate after module reload", async () => {
  const works = Array.from({ length: 8 }, () => deferred<number>()),
    ends = Array.from({ length: 8 }, () => deferred<void>()),
    clocks = Array.from({ length: 8 }, clock);
  let opens = 0;
  const factory: ConsumerSqlFactory = async (_c, b, o) => {
    const db = database(o, ends[opens++]!.promise);
    b.signal.addEventListener(
      "abort",
      () => {
        void db.close();
      },
      { once: true },
    );
    return db;
  };
  const calls = clocks.map((c, i) =>
    runConsumerSqlPhase(config, c.budget, factory, () => works[i]!.promise),
  );
  await tick();
  const extra = () =>
    runConsumerSqlPhase(config, clock().budget, factory, async () => 99);
  await expect(extra()).rejects.toMatchObject({ code: "BUSY" });
  expect(opens).toBe(8);
  const observed = calls.map((p) => p.catch((e) => e));
  clocks.forEach((c) => c.controller.abort());
  expect(
    (await Promise.all(observed)).every(
      (e) => e instanceof ConsumerError && e.code === "TIMEOUT",
    ),
  ).toBe(true);
  await expect(extra()).rejects.toMatchObject({ code: "BUSY" });
  ends[0]!.resolve();
  await tick();
  await expect(extra()).rejects.toMatchObject({ code: "BUSY" });
  await vi.resetModules();
  const second = await import("./sql-owner");
  await expect(
    second.runConsumerSqlPhase(config, clock().budget, factory, async () => 99),
  ).rejects.toMatchObject({ code: "BUSY" });
  expect(opens).toBe(8);
  works[0]!.resolve(1);
  await tick();
  let replacementOpens = 0;
  expect(
    await second.runConsumerSqlPhase(
      config,
      clock().budget,
      async (_c, _b, o) => {
        replacementOpens++;
        return database(o);
      },
      async () => 42,
    ),
  ).toBe(42);
  expect(replacementOpens).toBe(1);
  for (let i = 1; i < 8; i++) {
    works[i]!.resolve(i);
    ends[i]!.resolve();
  }
  await tick();
});
it("releases explicit never-allocated failures and business UNKNOWN only when actual resources really close", async () => {
  let never = 0;
  for (let i = 0; i < 100; i++)
    await expect(
      runConsumerSqlPhase(
        config,
        clock().budget,
        async (_c, _b, o) => {
          never++;
          o.neverAllocated();
          throw new ConsumerError("INVALID_REQUEST");
        },
        async () => 0,
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(never).toBe(100);
  for (let i = 0; i < 12; i++)
    await expect(
      runConsumerSqlPhase(
        config,
        clock().budget,
        async (_c, _b, o) => database(o),
        async () => {
          throw new ConsumerError("OUTCOME_UNKNOWN");
        },
      ),
    ).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
  expect(
    await runConsumerSqlPhase(
      config,
      clock().budget,
      async (_c, _b, o) => database(o),
      async () => 7,
    ),
  ).toBe(7);
});
it("retains early verification failures when the factory swallows unknown actual close, and releases exactly late proven closes", async () => {
  const ends = Array.from({ length: 8 }, () => deferred<void>());
  let opens = 0;
  const factory: ConsumerSqlFactory = async (_c, _b, o) => {
    o.allocated({} as P2aDatabase["sql"]);
    o.verification(Promise.reject(new Error("synthetic-verification")));
    o.ending(ends[opens++]!.promise);
    throw new ConsumerError("UNAVAILABLE");
  };
  for (let i = 0; i < 8; i++)
    await expect(
      runConsumerSqlPhase(config, clock().budget, factory, async () => 0),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  for (let i = 0; i < 100; i++)
    await expect(
      runConsumerSqlPhase(config, clock().budget, factory, async () => 0),
    ).rejects.toMatchObject({ code: "BUSY" });
  expect(opens).toBe(8);
  ends[0]!.resolve();
  await tick();
  expect(
    await runConsumerSqlPhase(
      config,
      clock().budget,
      async (_c, _b, o) => database(o),
      async () => 11,
    ),
  ).toBe(11);
  for (let i = 1; i < 8; i++) ends[i]!.resolve();
  await tick();
});
it("never frees a closed pool while its actual verification is still pending", async () => {
  const verifications = Array.from({ length: 8 }, () => deferred<void>());
  let opens = 0;
  const factory: ConsumerSqlFactory = async (_c, _b, o) => {
    o.allocated({} as P2aDatabase["sql"]);
    o.verification(verifications[opens++]!.promise);
    o.ending(Promise.resolve());
    throw new ConsumerError("UNAVAILABLE");
  };
  for (let i = 0; i < 8; i++)
    await expect(
      runConsumerSqlPhase(config, clock().budget, factory, async () => 0),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  await expect(
    runConsumerSqlPhase(config, clock().budget, factory, async () => 0),
  ).rejects.toMatchObject({ code: "BUSY" });
  verifications.forEach((p) => p.reject(new Error("synthetic-settled")));
  await tick();
});
// Last: no reset hook is used to erase permanent rejected-close ownership.
it("quarantines eight rejected real close observations permanently and refuses 100 later opens", async () => {
  let opens = 0;
  const factory: ConsumerSqlFactory = async (_c, _b, o) => {
    opens++;
    return database(o, Promise.reject(new Error("synthetic-close")));
  };
  for (let i = 0; i < 8; i++)
    await expect(
      runConsumerSqlPhase(config, clock().budget, factory, async () => 0),
    ).rejects.toThrow("synthetic-close");
  for (let i = 0; i < 100; i++)
    await expect(
      runConsumerSqlPhase(config, clock().budget, factory, async () => 0),
    ).rejects.toMatchObject({ code: "BUSY" });
  expect(opens).toBe(8);
});
