import { afterEach, expect, it, vi } from "vitest";
import type { P2aRuntimeConfig } from "@/lib/db/runtime";
const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ openSql: mocks.open }));
import { StorageLock } from "./storage-lock";
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
const fake = () => {
  let settle: () => void = () => {};
  const pending = new Promise<void>((r) => {
    settle = r;
  });
  const client = { end: vi.fn(async () => {}) },
    connection = Object.assign(() => pending, {
      release: vi.fn(),
    });
  const lock = Reflect.construct(StorageLock, [
    client,
    connection,
  ]) as StorageLock;
  return { client, connection, lock, settle };
};
it("a never-settling check invalidates and closes client at its 2s wall deadline", async () => {
  vi.useFakeTimers();
  const { client, lock, settle } = fake();
  const operation = lock.check().then(
    () => "SUCCESS",
    (e) => (e instanceof Error ? e.message : "FAILED"),
  );
  await vi.advanceTimersByTimeAsync(2001);
  expect(await operation).toBe("RECEIVE_LOCK_LOST");
  expect(lock.controller.signal.aborted).toBe(true);
  expect(() => lock.assert()).toThrow("RECEIVE_LOCK_LOST");
  expect(client.end).toHaveBeenCalled();
  settle();
  await lock.close();
});
it("close bounds a withheld unlock and invalidates its reserved handle", async () => {
  vi.useFakeTimers();
  const { client, connection, lock, settle } = fake();
  const closed = lock.close();
  await vi.advanceTimersByTimeAsync(2001);
  settle();
  await closed;
  expect(lock.controller.signal.aborted).toBe(true);
  expect(client.end).toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalledOnce();
});

it("invalid query rejects before invoking its factory, with no late unhandled rejection", async () => {
  vi.useFakeTimers();
  const { lock, settle } = fake();
  const closed = lock.close();
  await vi.advanceTimersByTimeAsync(2001);
  settle();
  await closed;
  vi.useRealTimers();
  const factory = vi.fn(() => Promise.reject(new Error("LATE_REJECTION")));
  let unhandled = false;
  const observe = () => {
    unhandled = true;
  };
  process.on("unhandledRejection", observe);
  try {
    await expect(lock.query(factory)).rejects.toThrow("RECEIVE_LOCK_LOST");
    await new Promise<void>((r) => setImmediate(r));
    expect(factory).not.toHaveBeenCalled();
    expect(unhandled).toBe(false);
  } finally {
    process.removeListener("unhandledRejection", observe);
  }
}, 5000);
it.each(["deadline", "abort"] as const)(
  "factory crossing %s still has its rejection observed",
  async (kind) => {
    const client = { end: vi.fn(async () => {}) },
      connection = Object.assign(() => Promise.resolve([]), {
        release: vi.fn(),
      }),
      controller = new AbortController(),
      context = {
        signal: controller.signal,
        deadlineMonotonicMs: performance.now() + 1000,
      };
    const lock = Reflect.construct(StorageLock, [
      client,
      connection,
      context,
    ]) as StorageLock;
    let unhandled = false;
    const observe = () => {
      unhandled = true;
    };
    process.on("unhandledRejection", observe);
    const factory = vi.fn(() => {
      if (kind === "deadline")
        context.deadlineMonotonicMs = performance.now() - 1;
      else controller.abort();
      return Promise.reject(new Error("FACTORY_REJECTION"));
    });
    try {
      await expect(lock.query(factory)).rejects.toThrow("RECEIVE_LOCK_LOST");
      await new Promise<void>((r) => setImmediate(r));
      expect(factory).toHaveBeenCalledOnce();
      expect(unhandled).toBe(false);
      expect(lock.controller.signal.aborted).toBe(true);
    } finally {
      process.removeListener("unhandledRejection", observe);
      await lock.close();
    }
  },
);
it("standalone Node observes rejection when a factory expires or aborts its context", async () => {
  const { spawn } = await import("node:child_process");
  const result = await new Promise<{ output: string; failed: boolean }>(
    (resolve) => {
      const child = spawn(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "tests/db/p2b2-query-child.ts",
        ],
        { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "",
        failed = false;
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
      });
      child.stderr.on("data", () => {
        failed = true;
      });
      child.once("error", () => resolve({ output: "", failed: true }));
      child.once("close", (code) =>
        resolve({ output, failed: failed || code !== 0 }),
      );
    },
  );
  expect(result.failed).toBe(false);
  expect(result.output).toBe("QUERY_OBSERVATION_OK\n");
});

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function driver() {
  const connection = Object.assign(
      vi.fn(async () => [{ locked: true }]),
      { release: vi.fn() },
    ),
    client = Object.assign(vi.fn(), {
      reserve: vi.fn(async () => connection),
      end: vi.fn(async () => {}),
    });
  mocks.open.mockReturnValue(client);
  return { connection, client };
}
it("close observes timed-out underlying SQL and all close calls wait for its actual settlement", async () => {
  vi.useFakeTimers();
  const { client } = driver(),
    lock = await StorageLock.acquire({ database: {} } as P2aRuntimeConfig),
    io = deferred<void>();
  const query = lock.query(() => io.promise),
    failed = expect(query).rejects.toMatchObject({ code: "RECEIVE_LOCK_LOST" });
  await vi.advanceTimersByTimeAsync(2000);
  await failed;
  let closes = 0;
  const first = lock.close().then((value) => {
      closes++;
      return value;
    }),
    second = lock.close().then((value) => {
      closes++;
      return value;
    });
  await Promise.resolve();
  await Promise.resolve();
  expect(closes).toBe(0);
  io.resolve();
  expect(await first).toBe(true);
  expect(await second).toBe(true);
  expect(closes).toBe(2);
  expect(client.end).toHaveBeenCalled();
});
it("failed driver close is reported rather than accepted as settled proof", async () => {
  vi.useFakeTimers();
  const { client } = driver(),
    lock = await StorageLock.acquire({ database: {} } as P2aRuntimeConfig);
  client.end.mockRejectedValue(new Error("SYNTHETIC_CLOSE_FAILURE"));
  expect(await lock.close()).toBe(false);
  expect(await lock.close()).toBe(false);
});
it("acquisition timeout keeps ownership of a late reserve until it actually settles", async () => {
  vi.useFakeTimers();
  const { client, connection } = driver(),
    reserve = deferred<typeof connection>();
  client.reserve.mockImplementation(() => reserve.promise);
  let finished = false;
  const acquire = StorageLock.acquire({
    database: {},
  } as P2aRuntimeConfig).catch(() => {
    finished = true;
  });
  await vi.advanceTimersByTimeAsync(2000);
  expect(finished).toBe(false);
  reserve.resolve(connection);
  await acquire;
  expect(finished).toBe(true);
});
