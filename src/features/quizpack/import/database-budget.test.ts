import { afterEach, expect, it, vi } from "vitest";
import type { P2aDatabase } from "@/lib/db/client";
import { receiveDatabaseAwait } from "./database-budget";
afterEach(() => vi.useRealTimers());
const fixture = () =>
  ({ sql: { end: vi.fn(async () => {}) } }) as unknown as P2aDatabase;
it.each(["read", "write"] as const)(
  "%s timeout destroys dedicated DB and observes a late rejection",
  async (kind) => {
    vi.useFakeTimers();
    const db = fixture();
    const context = {
      signal: new AbortController().signal,
      deadlineMonotonicMs: performance.now() + 25,
    };
    let reject!: (e: Error) => void;
    const pending = new Promise<never>((_, r) => {
      reject = r;
    });
    const result = receiveDatabaseAwait(db, context, kind, () => pending).then(
      () => "SUCCESS",
      (e) => (e instanceof Error ? e.message : "FAILED"),
    );
    await vi.advanceTimersByTimeAsync(30);
    expect(await result).toBe(
      kind === "read" ? "RECEIVE_TIMEOUT" : "WRITE_OUTCOME_UNKNOWN",
    );
    expect(db.sql.end).toHaveBeenCalledWith({ timeout: 0 });
    reject(new Error("LATE_REJECTION"));
    await Promise.resolve();
    await expect(
      receiveDatabaseAwait(
        db,
        { ...context, deadlineMonotonicMs: performance.now() + 1000 },
        kind,
        async () => 1,
      ),
    ).rejects.toThrow(
      kind === "read" ? "RECEIVE_TIMEOUT" : "WRITE_OUTCOME_UNKNOWN",
    );
  },
);
it("request abort interrupts pending DB and a confirmed result is not reclassified after deadline", async () => {
  const db = fixture(),
    controller = new AbortController(),
    context = {
      signal: controller.signal,
      deadlineMonotonicMs: performance.now() + 1000,
    };
  const wait = receiveDatabaseAwait(
    db,
    context,
    "read",
    () => new Promise(() => {}),
  ).then(
    () => "SUCCESS",
    (e) => (e instanceof Error ? e.message : "FAILED"),
  );
  controller.abort();
  expect(await wait).toBe("RECEIVE_TIMEOUT");
  const confirmed = fixture(),
    fresh = {
      signal: new AbortController().signal,
      deadlineMonotonicMs: performance.now() + 1000,
    };
  expect(
    await receiveDatabaseAwait(confirmed, fresh, "write", async () => {
      fresh.deadlineMonotonicMs = performance.now() - 1;
      return 7;
    }),
  ).toBe(7);
  expect(confirmed.sql.end).not.toHaveBeenCalled();
});
