import { afterEach, expect, it, vi } from "vitest";
import type postgres from "postgres";
import type { P2aDatabase } from "@/lib/db/client";
import type { StudioActor } from "@/lib/auth/capabilities";
import { withStudioWrite } from "@/lib/auth/write";
import { StudioError } from "@/lib/http-security/errors";
import { ResourceReadTask } from "@/features/quizpack/resource-read/task";
import { createInternalVersionOwner } from "./lifecycle";

const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const credentials = {
  sessionToken: "synthetic",
  csrfToken: "synthetic",
  requestId: "00000000-0000-4000-8000-000000000001",
};
const write: typeof withStudioWrite = async (
  _db,
  _credentials,
  _capability,
  work,
) => work({} as postgres.TransactionSql, {} as StudioActor);
function setup(
  overrides: {
    close?: () => Promise<void>;
    write?: typeof withStudioWrite;
  } = {},
) {
  const controller = new AbortController(),
    lost = new AbortController();
  const budget = {
    signal: controller.signal,
    deadlineMonotonicMs: performance.now() + 15000,
  };
  const clock = { budget, dispose: vi.fn() };
  const db = {
    config: {},
    close: vi.fn(overrides.close ?? (async () => undefined)),
  } as unknown as P2aDatabase;
  const guard = {
    signal: lost.signal,
    assert: vi.fn(),
    check: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  const acquireGuard = vi.fn(async () => guard);
  const owner = createInternalVersionOwner(db, clock, {
    acquireGuard,
    write: overrides.write ?? write,
  });
  return { controller, lost, budget, clock, db, guard, acquireGuard, owner };
}
afterEach(() => vi.useRealTimers());
it("has no slot/guard for fast return and rejects different DB/budget or repeat use", async () => {
  const h = setup();
  expect(() => h.owner.assertOwns({ ...h.db }, h.budget)).toThrow(
    "INVALID_REQUEST",
  );
  expect(() => h.owner.assertOwns(h.db, { ...h.budget })).toThrow(
    "INVALID_REQUEST",
  );
  await h.owner.closeIfNotTransferred();
  await h.owner.closeIfNotTransferred();
  expect(h.db.close).toHaveBeenCalledTimes(1);
  expect(h.clock.dispose).toHaveBeenCalledTimes(1);
  expect(h.acquireGuard).not.toHaveBeenCalled();
  const s = setup();
  expect(await s.owner.runNew(s.db, s.budget, async () => 7)).toBe(7);
  await expect(s.owner.runNew(s.db, s.budget, async () => 8)).rejects.toThrow(
    "INVALID_REQUEST",
  );
});
it("keeps quota/DB/guard past HTTP cancellation until actual FS work and DB close settle", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const io = gate(),
    closed = gate();
  const tasks = Array.from({ length: 4 }, () =>
    setup({ close: () => closed.promise }),
  );
  const calls = tasks.map((h) =>
    h.owner.runNew(h.db, h.budget, async () => {
      await io.promise;
      return 1;
    }),
  );
  const observations = Promise.allSettled(calls);
  await flush();
  tasks.forEach((h) => h.controller.abort());
  await vi.advanceTimersByTimeAsync(5000);
  expect((await observations).every((r) => r.status === "rejected")).toBe(true);
  for (const h of tasks) {
    await h.owner.closeIfNotTransferred();
    expect(h.db.close).not.toHaveBeenCalled();
    expect(h.guard.close).not.toHaveBeenCalled();
    expect(h.clock.dispose).not.toHaveBeenCalled();
  }
  expect(() => ResourceReadTask.acquire(new AbortController().signal)).toThrow(
    "PREVIEW_BUSY",
  );
  io.resolve();
  await flush();
  for (const h of tasks) {
    expect(h.db.close).toHaveBeenCalledTimes(1);
    expect(h.guard.close).not.toHaveBeenCalled();
  }
  expect(() => ResourceReadTask.acquire(new AbortController().signal)).toThrow(
    "PREVIEW_BUSY",
  );
  closed.resolve();
  await flush();
  for (const h of tasks) {
    expect(h.guard.close).toHaveBeenCalledTimes(1);
    expect(h.clock.dispose).toHaveBeenCalledTimes(1);
  }
  await ResourceReadTask.acquire(new AbortController().signal).run(
    async () => undefined,
  );
});
it("cancellation before task callback does not transfer and HTTP retains DB close", async () => {
  const h = setup();
  h.controller.abort();
  const work = vi.fn(async () => 1);
  await expect(h.owner.runNew(h.db, h.budget, work)).rejects.toThrow(
    "PREVIEW_CANCELLED",
  );
  expect(work).not.toHaveBeenCalled();
  expect(h.acquireGuard).not.toHaveBeenCalled();
  expect(h.db.close).not.toHaveBeenCalled();
  await h.owner.closeIfNotTransferred();
  expect(h.db.close).toHaveBeenCalledTimes(1);
  expect(h.clock.dispose).toHaveBeenCalledTimes(1);
});
it("observes late committed writes without presenting cancellation as rollback", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const commit = gate();
  const late: typeof withStudioWrite = async (db, c, cap, work) => {
    const value = await write(db, c, cap, work);
    await commit.promise;
    return value;
  };
  const h = setup({ write: late });
  const call = h.owner.runNew(h.db, h.budget, (c) =>
    c.write(credentials, "version:seal-internal", async () => "committed"),
  );
  const observed = call.catch((e) => e);
  await flush();
  h.controller.abort();
  await vi.advanceTimersByTimeAsync(5000);
  expect((await observed).code).toBe("WRITE_OUTCOME_UNKNOWN");
  expect(h.db.close).not.toHaveBeenCalled();
  commit.resolve();
  await flush();
  expect(h.db.close).toHaveBeenCalledTimes(1);
  expect(h.guard.close).toHaveBeenCalledTimes(1);
});
it("distinguishes confirmed rollback, commit uncertainty, and successful driver completion", async () => {
  for (const code of ["WRITE_BUSY", "WRITE_OUTCOME_UNKNOWN"] as const) {
    const h = setup({
      write: async () => {
        throw new StudioError(code);
      },
    });
    await expect(
      h.owner.runNew(h.db, h.budget, (c) =>
        c.write(credentials, "review:record-baseline", async () => 1),
      ),
    ).rejects.toThrow(code);
    expect(h.db.close).toHaveBeenCalledTimes(1);
    expect(h.guard.close).toHaveBeenCalledTimes(1);
  }
  const h = setup();
  expect(
    await h.owner.runNew(h.db, h.budget, (c) =>
      c.write(credentials, "review:record-baseline", async () => 9),
    ),
  ).toBe(9);
});
it("retains a guard after unconfirmed FD or DB close and never attempts a compensating unlock", async () => {
  const h = setup();
  await expect(
    h.owner.runNew(h.db, h.budget, async (c) => {
      c.quarantine({ syntheticFd: true });
      c.checkpoint();
    }),
  ).rejects.toThrow("PREVIEW_RESOURCE_UNAVAILABLE");
  await h.owner.closeIfNotTransferred();
  expect(h.db.close).toHaveBeenCalledTimes(1);
  expect(h.guard.close).not.toHaveBeenCalled();
  const bad = setup({
    close: async () => {
      throw Error("SYNTHETIC_CLOSE_UNCONFIRMED");
    },
  });
  await expect(
    bad.owner.runNew(bad.db, bad.budget, async () => 1),
  ).rejects.toThrow("PREVIEW_RESOURCE_UNAVAILABLE");
  await bad.owner.closeIfNotTransferred();
  expect(bad.db.close).toHaveBeenCalledTimes(1);
  expect(bad.guard.close).not.toHaveBeenCalled();
});
