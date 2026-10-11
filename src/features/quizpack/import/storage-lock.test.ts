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
