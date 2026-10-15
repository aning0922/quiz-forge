import type postgres from "postgres";
import { expect, it, vi } from "vitest";
import type { TestDatabase } from "./p2a-fixture";
import {
  waitForPreviewAuthBudget,
  type PreviewAuthBudgetObservation,
} from "./p3c-auth-budget";
function fixture(observations: PreviewAuthBudgetObservation[]) {
  let now = 100;
  const waits: number[] = [],
    queries: string[] = [];
  const tx = ((sql: TemplateStringsArray) => {
    queries.push(sql.join("?"));
    return Promise.resolve(
      sql.join("").includes("WITH moment") ? [observations.shift()] : [],
    );
  }) as unknown as postgres.TransactionSql;
  const begin = vi.fn(
    async (
      options: string,
      work: (t: postgres.TransactionSql) => Promise<unknown>,
    ) => {
      expect(options).toBe("read only");
      return work(tx);
    },
  );
  const db = {
    config: { purpose: "test" },
    admin: { sql: { begin } },
  } as unknown as TestDatabase;
  return {
    db,
    begin,
    queries,
    waits,
    time: {
      now: () => now,
      wait: async (ms: number) => {
        waits.push(ms);
        now += ms;
      },
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}
it("fresh window returns immediately without modifying audit/session/config", async () => {
  const f = fixture([{ recent: 0, outstanding: 0, retry_after_ms: 0 }]);
  await waitForPreviewAuthBudget(f.db, f.time);
  expect(f.waits).toEqual([]);
  expect(f.begin).toHaveBeenCalledOnce();
  expect(f.queries.join(" ")).not.toMatch(/INSERT|UPDATE|DELETE|TRUNCATE/i);
});
it("waits for the full real window and requires a fresh successful observation", async () => {
  const f = fixture([
    { recent: 20, outstanding: 2, retry_after_ms: 60000 },
    { recent: 0, outstanding: 2, retry_after_ms: 0 },
  ]);
  await waitForPreviewAuthBudget(f.db, f.time);
  expect(f.waits).toEqual([60025]);
  expect(f.begin).toHaveBeenCalledTimes(2);
});
it("an intervening request can require another bounded observation instead of assuming success", async () => {
  const f = fixture([
    { recent: 1, outstanding: 0, retry_after_ms: 100 },
    { recent: 1, outstanding: 0, retry_after_ms: 100 },
    { recent: 0, outstanding: 0, retry_after_ms: 0 },
  ]);
  await waitForPreviewAuthBudget(f.db, f.time);
  expect(f.waits).toEqual([125, 125]);
});
it("100 outstanding challenges that cannot expire within one window fail without waiting five minutes", async () => {
  const f = fixture([{ recent: 0, outstanding: 100, retry_after_ms: 300000 }]);
  await expect(waitForPreviewAuthBudget(f.db, f.time)).rejects.toThrow(
    "PREVIEW_AUTH_BUDGET_UNAVAILABLE",
  );
  expect(f.waits).toEqual([]);
});
it("one-window deadline is absolute and never resets on another busy observation", async () => {
  const f = fixture([
    { recent: 20, outstanding: 0, retry_after_ms: 60000 },
    { recent: 20, outstanding: 0, retry_after_ms: 60000 },
  ]);
  await expect(waitForPreviewAuthBudget(f.db, f.time)).rejects.toThrow(
    "PREVIEW_AUTH_BUDGET_UNAVAILABLE",
  );
  expect(f.waits).toEqual([60025]);
});
it("malformed facts and non-test databases cannot grant a ready budget", async () => {
  const f = fixture([{ recent: NaN, outstanding: 0, retry_after_ms: 0 }]);
  await expect(waitForPreviewAuthBudget(f.db, f.time)).rejects.toThrow(
    "PREVIEW_AUTH_BUDGET_UNAVAILABLE",
  );
  const demo = {
    ...f.db,
    config: { purpose: "demo" },
  } as unknown as TestDatabase;
  await expect(waitForPreviewAuthBudget(demo, f.time)).rejects.toThrow(
    "PREVIEW_AUTH_BUDGET_UNAVAILABLE",
  );
  expect(f.begin).toHaveBeenCalledOnce();
});
it("query time also consumes the original wait deadline", async () => {
  const f = fixture([{ recent: 0, outstanding: 0, retry_after_ms: 0 }]);
  const begin = f.begin.getMockImplementation()!;
  f.begin.mockImplementation(async (...args) => {
    const result = await begin(...args);
    f.advance(61000);
    return result;
  });
  await expect(waitForPreviewAuthBudget(f.db, f.time)).rejects.toThrow(
    "PREVIEW_AUTH_BUDGET_UNAVAILABLE",
  );
});
