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
