import { afterEach, expect, it, vi } from "vitest";
import { StorageLock } from "./storage-lock";
afterEach(() => vi.useRealTimers());
const fake = () => {
  const client = { end: vi.fn(async () => {}) },
    connection = Object.assign(() => new Promise(() => {}), {
      release: vi.fn(),
    });
  const lock = Reflect.construct(StorageLock, [
    client,
    connection,
  ]) as StorageLock;
  return { client, connection, lock };
};
it("a never-settling check invalidates and closes client at its 2s wall deadline", async () => {
  vi.useFakeTimers();
  const { client, lock } = fake();
  const operation = lock.check().then(
    () => "SUCCESS",
    (e) => (e instanceof Error ? e.message : "FAILED"),
  );
  await vi.advanceTimersByTimeAsync(2001);
  expect(await operation).toBe("RECEIVE_LOCK_LOST");
  expect(lock.controller.signal.aborted).toBe(true);
  expect(() => lock.assert()).toThrow("RECEIVE_LOCK_LOST");
  expect(client.end).toHaveBeenCalled();
  await lock.close();
});
it("close bounds a withheld unlock and invalidates its reserved handle", async () => {
  vi.useFakeTimers();
  const { client, connection, lock } = fake();
  const closed = lock.close();
  await vi.advanceTimersByTimeAsync(2001);
  await closed;
  expect(lock.controller.signal.aborted).toBe(true);
  expect(client.end).toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalledOnce();
});

it("invalid query rejects before invoking its factory, with no late unhandled rejection", async () => {
  vi.useFakeTimers();
  const { lock } = fake();
  const closed = lock.close();
  await vi.advanceTimersByTimeAsync(2001);
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
