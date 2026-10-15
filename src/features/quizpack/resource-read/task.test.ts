import { afterEach, expect, it, vi } from "vitest";
import { ResourceReadTask } from "./task";
import { PREVIEW_LIMITS } from "@/features/product/preview/limits";
const signal = () => new AbortController();
afterEach(() => vi.useRealTimers());
it("admits exactly four verified bodies, rejects fifth immediately, and releases on cancel", async () => {
  const tasks = Array.from({ length: 4 }, () =>
    ResourceReadTask.acquire(signal().signal),
  );
  const streams = await Promise.all(
    tasks.map((t) => t.run(async () => t.body(Buffer.alloc(200000)))),
  );
  expect(() => ResourceReadTask.acquire(signal().signal)).toThrow(
    "PREVIEW_BUSY",
  );
  await streams[0]!.cancel();
  const replacement = ResourceReadTask.acquire(signal().signal);
  await replacement.run(async () => undefined);
  await Promise.all(streams.slice(1).map((s) => s.cancel()));
});
it("cancelled unresolved work keeps all slots past the five-second observation window", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const controllers = Array.from({ length: 4 }, signal);
  const tasks = controllers.map((c) => ResourceReadTask.acquire(c.signal));
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const operations = tasks.map((t) =>
    t.run(async () => {
      await gate;
      t.checkpoint();
    }),
  );
  const observed = Promise.allSettled(operations);
  await Promise.resolve();
  controllers.forEach((c) => c.abort());
  await vi.advanceTimersByTimeAsync(PREVIEW_LIMITS.closeObservationMs);
  const results = await observed;
  expect(results.every((r) => r.status === "rejected")).toBe(true);
  expect(() => ResourceReadTask.acquire(signal().signal)).toThrow(
    "PREVIEW_BUSY",
  );
  release();
  await vi.advanceTimersByTimeAsync(0);
  const replacement = ResourceReadTask.acquire(signal().signal);
  await replacement.run(async () => undefined);
});
it("slow body retains slot until total deadline, errors stream, and stops publication", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const task = ResourceReadTask.acquire(signal().signal);
  const stream = await task.run(async () => task.body(Buffer.alloc(200000)));
  await vi.advanceTimersByTimeAsync(PREVIEW_LIMITS.deadlineMs);
  await expect(stream.getReader().read()).rejects.toThrow("PREVIEW_TIMEOUT");
  const replacement = ResourceReadTask.acquire(signal().signal);
  await replacement.run(async () => undefined);
});
it("memory response chunks stay bounded and preserve all verified bytes", async () => {
  const bytes = Buffer.alloc(180123, 42),
    task = ResourceReadTask.acquire(signal().signal);
  const stream = await task.run(async () => task.body(bytes));
  const reader = stream.getReader();
  let count = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    expect(part.value.byteLength).toBeLessThanOrEqual(65536);
    expect(part.value.every((x) => x === 42)).toBe(true);
    count += part.value.length;
  }
  expect(count).toBe(bytes.length);
});
it("request abort cancels already prepared response", async () => {
  const controller = signal(),
    task = ResourceReadTask.acquire(controller.signal);
  const body = await task.run(async () => task.body(Buffer.alloc(200000)));
  controller.abort();
  await expect(body.getReader().read()).rejects.toThrow("PREVIEW_CANCELLED");
});
it("unconfirmed close ownership is quarantined after handler failure with no TTL release", async () => {
  const task = ResourceReadTask.acquire(signal().signal);
  await expect(
    task.run(async () => {
      task.quarantine({ testOnlyUnconfirmedHandle: true });
      task.checkpoint();
    }),
  ).rejects.toThrow("PREVIEW_RESOURCE_UNAVAILABLE");
  expect(task.hasUnconfirmedIo).toBe(true);
  const remaining = Array.from({ length: 3 }, () =>
    ResourceReadTask.acquire(signal().signal),
  );
  expect(() => ResourceReadTask.acquire(signal().signal)).toThrow(
    "PREVIEW_BUSY",
  );
  await Promise.all(remaining.map((t) => t.run(async () => undefined)));
});
