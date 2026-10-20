import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { P2aDatabase } from "@/lib/db/client";
import type { P2aRuntimeConfig } from "@/lib/db/runtime";
import type { DatabaseLifecycleObserver } from "@/lib/db/lifecycle-observer";
const h = vi.hoisted(() => ({ open: vi.fn(), guard: vi.fn() }));
vi.mock("@/lib/db/client", async (original) => ({
  ...(await original<object>()),
  createObservedDatabase: h.open,
}));
vi.mock("@/features/quizpack/resource-read/guard", () => ({
  StorageReadGuard: { acquire: h.guard },
}));
import { createConsumerRequestOwner } from "./request-owner";
import { ResourceReadTask } from "@/features/quizpack/resource-read/task";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
const config = {} as P2aRuntimeConfig;
function setupOwner() {
  const controller = new AbortController(),
    dispose = vi.fn();
  const clock = {
    budget: {
      signal: controller.signal,
      deadlineMonotonicMs: performance.now() + 15000,
    },
    dispose,
  };
  return {
    owner: createConsumerRequestOwner(config, clock),
    controller,
    dispose,
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  h.open.mockReset();
  h.guard.mockReset();
  h.open.mockImplementation(
    async (_c, _b, observer: DatabaseLifecycleObserver) => {
      const sql = {},
        actual = Promise.resolve();
      observer.allocated(sql as P2aDatabase["sql"]);
      observer.verification(Promise.resolve());
      let ended = false;
      return {
        sql,
        close: () => {
          if (!ended) {
            ended = true;
            observer.ending(actual);
          }
          return actual;
        },
      };
    },
  );
  h.guard.mockImplementation(async () => ({
    signal: new AbortController().signal,
    assert: vi.fn(),
    check: async () => {},
    close: async () => {},
  }));
});
afterEach(() => vi.useRealTimers());
async function resource(value = Buffer.alloc(200000, 7)) {
  const f = setupOwner();
  await f.owner.run("read-resource", async (context) => {
    await context.sql(async () => undefined);
    await context.io(async (io) => {
      io.issueBody(value);
      return value;
    });
  });
  return { ...f, bytes: value };
}
it("constructs lazily, admits one public call, and keeps exchange's two SQL phases sequential and bounded", async () => {
  const unused = setupOwner();
  expect(h.open).not.toHaveBeenCalled();
  await unused.owner.closeIfNotTransferred();
  expect(unused.dispose).toHaveBeenCalledTimes(1);
  const f = setupOwner(),
    clients: unknown[] = [];
  await expect(
    f.owner.run("exchange", async (c) => {
      clients.push(await c.sql(async (db) => db.sql));
      clients.push(await c.sql(async (db) => db.sql));
      await c.sql(async () => 0);
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect(clients).toHaveLength(2);
  expect(clients[0]).not.toBe(clients[1]);
  expect(h.open).toHaveBeenCalledTimes(2);
  await expect(
    f.owner.run("read-session", async () => 0),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await f.owner.closeIfNotTransferred();
  expect(f.dispose).toHaveBeenCalledTimes(1);
});
it("binds one exact bytes object and retains all four FS slots through the queued final chunk", async () => {
  const held = await Promise.all(
    Array.from({ length: 4 }, () => resource(Buffer.alloc(32, 11))),
  );
  const first = held[0]!;
  expect(() => first.owner.resourceBody(Uint8Array.from(first.bytes))).toThrow(
    "INVALID_REQUEST",
  );
  const streams = held.map((f) => f.owner.resourceBody(f.bytes));
  expect(() => first.owner.resourceBody(first.bytes)).toThrow(
    "INVALID_REQUEST",
  );
  await Promise.resolve();
  await Promise.resolve();
  // One tiny image fits into the stream's final queued chunk. No extra wrapper may pre-drain it.
  expect(() => ResourceReadTask.acquire(new AbortController().signal)).toThrow(
    "PREVIEW_BUSY",
  );
  held.forEach((f) => expect(f.dispose).not.toHaveBeenCalled());
  await Promise.all(held.map((f) => f.owner.closeIfNotTransferred()));
  const reader = streams[0]!.getReader();
  expect((await reader.read()).value).toEqual(Uint8Array.from(first.bytes));
  expect(await reader.read()).toEqual({ value: undefined, done: true });
  expect(first.dispose).toHaveBeenCalledTimes(1);
  const replacement = ResourceReadTask.acquire(new AbortController().signal);
  await replacement.run(async () => undefined);
  await Promise.all(streams.slice(1).map((s) => s.cancel()));
  held.forEach((f) => expect(f.dispose).toHaveBeenCalledTimes(1));
});
it("cancels an untransferred response and handles original request abort after handler finally", async () => {
  const untransferred = await resource();
  await untransferred.owner.closeIfNotTransferred();
  expect(untransferred.dispose).toHaveBeenCalledTimes(1);
  const abandoned = await resource();
  abandoned.controller.abort();
  await abandoned.owner.closeIfNotTransferred();
  expect(abandoned.dispose).toHaveBeenCalledTimes(1);
  const f = await resource(),
    stream = f.owner.resourceBody(f.bytes);
  await f.owner.closeIfNotTransferred();
  expect(f.dispose).not.toHaveBeenCalled();
  f.controller.abort();
  await expect(stream.getReader().read()).rejects.toThrow("PREVIEW_CANCELLED");
  expect(f.dispose).toHaveBeenCalledTimes(1);
});
it("settles a backpressured prepared body at the original total deadline without retaining a second queue", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const f = await resource(),
    stream = f.owner.resourceBody(f.bytes);
  await f.owner.closeIfNotTransferred();
  await vi.advanceTimersByTimeAsync(15000);
  await expect(stream.getReader().read()).rejects.toThrow("PREVIEW_TIMEOUT");
  expect(f.dispose).toHaveBeenCalledTimes(1);
});
it("disposes a request cancelled before the actual IO callback ever starts", async () => {
  const f = setupOwner(),
    entered = vi.fn();
  await expect(
    f.owner.run("read-resource", async (c) => {
      await c.sql(async () => 0);
      const pending = c.io(async () => {
        entered();
        return 1;
      });
      f.controller.abort();
      return pending;
    }),
  ).rejects.toThrow("PREVIEW_CANCELLED");
  await f.owner.closeIfNotTransferred();
  expect(entered).not.toHaveBeenCalled();
  expect(h.guard).not.toHaveBeenCalled();
  expect(f.dispose).toHaveBeenCalledTimes(1);
  const slots = Array.from({ length: 4 }, () =>
    ResourceReadTask.acquire(new AbortController().signal),
  );
  await Promise.all(slots.map((task) => task.run(async () => undefined)));
});
it("keeps the FS slot and maintenance guard while actual database close remains pending after request cancellation", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const gate = deferred(),
    guardClosed = vi.fn();
  h.guard.mockImplementation(async () => ({
    signal: new AbortController().signal,
    assert: () => {},
    check: async () => {},
    close: async () => {
      guardClosed();
    },
  }));
  let opens = 0;
  h.open.mockImplementation(
    async (_c, _b, observer: DatabaseLifecycleObserver) => {
      const sql = {};
      observer.allocated(sql as P2aDatabase["sql"]);
      observer.verification(Promise.resolve());
      const actual = opens++ === 0 ? Promise.resolve() : gate.promise;
      return {
        sql,
        close: () => {
          observer.ending(actual);
          return actual;
        },
      };
    },
  );
  const f = setupOwner();
  const actual = f.owner.run("complete", async (c) => {
    await c.sql(async () => 0);
    return c.io(async () => 1);
  });
  const observed = actual.catch((e) => e);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  f.controller.abort();
  await vi.advanceTimersByTimeAsync(5000);
  await observed;
  await f.owner.closeIfNotTransferred();
  expect(guardClosed).not.toHaveBeenCalled();
  const remaining = Array.from({ length: 3 }, () =>
    ResourceReadTask.acquire(new AbortController().signal),
  );
  expect(() => ResourceReadTask.acquire(new AbortController().signal)).toThrow(
    "PREVIEW_BUSY",
  );
  gate.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(guardClosed).toHaveBeenCalledTimes(1);
  await Promise.all(remaining.map((t) => t.run(async () => undefined)));
  expect(f.dispose).toHaveBeenCalledTimes(1);
});
it("permits two successful exchange phases only after each actual close succeeds", async () => {
  const f = setupOwner();
  expect(
    await f.owner.run("exchange", async (c) => [
      await c.sql(async () => 1),
      await c.sql(async () => 2),
    ]),
  ).toEqual([1, 2]);
  expect(h.open).toHaveBeenCalledTimes(2);
  await f.owner.closeIfNotTransferred();
});
it("blocks every successor SQL or IO when a rejected callback is caught by the caller", async () => {
  for (const operation of ["exchange", "complete"] as const) {
    h.open.mockClear();
    h.guard.mockClear();
    const f = setupOwner(),
      next = vi.fn();
    expect(
      await f.owner.run(operation, async (c) => {
        await expect(
          c.sql(async () => {
            throw new ConsumerError("OPERATION_CONFLICT");
          }),
        ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
        await expect(
          c.sql(async () => {
            next();
          }),
        ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
        await expect(
          c.io(async () => {
            next();
          }),
        ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
        return "successors-blocked";
      }),
    ).toBe("successors-blocked");
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(h.guard).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    await f.owner.closeIfNotTransferred();
  }
});
it("blocks successors after pending close cancellation and never revives the request after its late success", async () => {
  const f = setupOwner(),
    gate = deferred(),
    next = vi.fn();
  h.open.mockImplementation(async (_c, _b, o: DatabaseLifecycleObserver) => {
    const sql = {};
    o.allocated(sql as P2aDatabase["sql"]);
    o.verification(Promise.resolve());
    return {
      sql,
      close: () => {
        o.ending(gate.promise);
        return gate.promise;
      },
    };
  });
  const result = f.owner.run("exchange", async (c) => {
    await expect(c.sql(async () => 1)).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    await expect(
      c.sql(async () => {
        next();
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    await expect(
      c.io(async () => {
        next();
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    gate.resolve();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    await expect(
      c.sql(async () => {
        next();
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    return "successors-blocked";
  });
  for (let i = 0; i < 30; i++) await Promise.resolve();
  f.controller.abort();
  expect(await result).toBe("successors-blocked");
  expect(h.open).toHaveBeenCalledTimes(1);
  expect(h.guard).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
  await f.owner.closeIfNotTransferred();
});
// Permanent close rejection remains quarantined in this isolated worker; no reset clears it.
it("blocks successor factories and IO after actual end rejection even when the first error is caught", async () => {
  for (const operation of ["exchange", "complete"] as const) {
    h.open.mockReset();
    h.guard.mockClear();
    h.open.mockImplementation(async (_c, _b, o: DatabaseLifecycleObserver) => {
      const sql = {};
      o.allocated(sql as P2aDatabase["sql"]);
      o.verification(Promise.resolve());
      let actual: Promise<void> | undefined;
      return {
        sql,
        close: () => {
          if (!actual) {
            actual = Promise.reject(new Error("synthetic-predecessor-close"));
            o.ending(actual);
          }
          return actual;
        },
      };
    });
    const f = setupOwner(),
      next = vi.fn();
    expect(
      await f.owner.run(operation, async (c) => {
        await expect(c.sql(async () => 1)).rejects.toThrow(
          "synthetic-predecessor-close",
        );
        await expect(
          c.sql(async () => {
            next();
          }),
        ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
        await expect(
          c.io(async () => {
            next();
          }),
        ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
        return "successors-blocked";
      }),
    ).toBe("successors-blocked");
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(h.guard).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    await f.owner.closeIfNotTransferred();
  }
});
