import { setTimeout as delay } from "node:timers/promises";
import type { TestDatabase } from "./p2a-fixture";

const MAX_WAIT_MS = 61_000;
export type PreviewAuthBudgetObservation = Readonly<{
  recent: number;
  outstanding: number;
  retry_after_ms: number;
}>;
export type PreviewAuthBudgetClock = Readonly<{
  now: () => number;
  wait: (milliseconds: number) => Promise<void>;
}>;
const clock: PreviewAuthBudgetClock = {
  now: () => performance.now(),
  wait: async (ms) => {
    await delay(ms);
  },
};
const unavailable = () => Error("PREVIEW_AUTH_BUDGET_UNAVAILABLE");
/** Test CLI coordination only. Observe the real shared limiter without editing its history or limits. */
export async function waitForPreviewAuthBudget(
  db: TestDatabase,
  time: PreviewAuthBudgetClock = clock,
): Promise<void> {
  if (!["test", "ci"].includes(db.config.purpose)) throw unavailable();
  const deadline = time.now() + MAX_WAIT_MS;
  for (;;) {
    if (time.now() >= deadline) throw unavailable();
    const facts = await db.admin.sql.begin("read only", async (tx) => {
      await tx`SET LOCAL statement_timeout='2s'`;
      await tx`SET LOCAL transaction_timeout='5s'`;
      const [row] = await tx<PreviewAuthBudgetObservation[]>`
        WITH moment AS MATERIALIZED (SELECT clock_timestamp() now),
        recent AS (SELECT count(*)::int count,max(occurred_at) latest FROM qf.audit_event,moment
          WHERE action='preauth_created' AND outcome='success' AND occurred_at>moment.now-interval '60 seconds'),
        outstanding AS (SELECT count(*)::int count,min(LEAST(idle_expires_at,absolute_expires_at)) first_expiry
          FROM qf.operator_session,moment WHERE kind='preauth' AND revoked_at IS NULL
          AND idle_expires_at>moment.now AND absolute_expires_at>moment.now)
        SELECT recent.count recent,outstanding.count outstanding,
          CEIL(GREATEST(0,
            CASE WHEN recent.count>0 THEN EXTRACT(EPOCH FROM recent.latest+interval '60 seconds'-moment.now)*1000 ELSE 0 END,
            CASE WHEN outstanding.count>=100 THEN EXTRACT(EPOCH FROM outstanding.first_expiry-moment.now)*1000 ELSE 0 END))::int retry_after_ms
        FROM moment,recent,outstanding`;
      return row;
    });
    if (
      time.now() >= deadline ||
      !facts ||
      ![facts.recent, facts.outstanding, facts.retry_after_ms].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      )
    )
      throw unavailable();
    // Start this serial E2E group with the full real 20/min window, not merely one bootstrap slot.
    if (facts.recent === 0 && facts.outstanding < 100) return;
    const waiting = Math.max(25, facts.retry_after_ms + 25);
    if (waiting >= deadline - time.now()) throw unavailable();
    await time.wait(waiting);
    // A fresh DB observation is mandatory. Waiting never grants authentication by itself.
  }
}
