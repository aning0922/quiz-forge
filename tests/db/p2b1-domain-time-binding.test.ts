import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import {
  authenticateTestOperator,
  openTestDatabase,
  resetTestDatabase,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
import { disableOperator } from "@/lib/db/management";
import { readSession } from "@/lib/auth/service";
let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await safe(openTestDatabase);
});
beforeEach(async () => {
  await safe(() => resetTestDatabase(fixture));
});
afterAll(async () => {
  await fixture?.close();
});
describe("PG microsecond preservation in management time bindings", () => {
  it("forces text OID25 and preserves microseconds through repeated prepared executions", async () => {
    const connection = await fixture.admin.sql.reserve();
    const synthetic = "2001-02-03 04:05:06.123456+00";
    try {
      const unprotected = (value: string) =>
        connection`SELECT ${value}::timestamptz`;
      const preserved = (value: string) =>
        connection`SELECT (EXTRACT(epoch FROM (${value}::text::timestamptz - '2001-02-03 04:05:06.123456+00'::timestamptz))*1000000)::integer delta`;
      expect(
        (await safe(() => unprotected(synthetic).describe())).types,
      ).toEqual([1184]);
      expect((await safe(() => preserved(synthetic).describe())).types).toEqual(
        [25],
      );
      for (let attempt = 0; attempt < 8; attempt++) {
        const [row] = await safe(() => preserved(synthetic));
        expect(row?.delta).toBe(0);
      }
    } finally {
      connection.release();
    }
  });
  it("actual disable path preserves submillisecond precision in all three stored times", async () => {
    const submillisecondSamples = { disabled: 0, revoked: 0, receipt: 0 };
    const confirmed: Array<{ targetId: string; operationId: string }> = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      const auth = await authenticateTestOperator(fixture),
        operatorId = auth.id;
      const { sessionId } = await readSession(fixture.app, auth.session.raw);
      expect(
        await safe(() =>
          disableOperator(fixture.config.instanceId, operatorId),
        ),
      ).toEqual({ id: operatorId, changed: true });
      const rows = await safe(
        () => fixture.admin.sql<
          {
            operation_id: string;
            valid_session_time: boolean;
            valid_disable_time: boolean;
            valid_receipt_time: boolean;
            disabled_submillisecond: boolean;
            revoked_submillisecond: boolean;
            receipt_submillisecond: boolean;
          }[]
        >`SELECT a.operation_id,
        s.revoked_at>=s.created_at AS valid_session_time,
        o.disabled_at>=s.created_at AND s.revoked_at>=o.disabled_at AS valid_disable_time,
        a.created_at>=s.revoked_at AS valid_receipt_time,
        mod(EXTRACT(microseconds FROM o.disabled_at)::bigint,1000)<>0 AS disabled_submillisecond,
        mod(EXTRACT(microseconds FROM s.revoked_at)::bigint,1000)<>0 AS revoked_submillisecond,
        mod(EXTRACT(microseconds FROM a.created_at)::bigint,1000)<>0 AS receipt_submillisecond
        FROM qf.operator_session s JOIN qf.operator o ON o.id=s.operator_id
        JOIN qf.operator_account_operation a ON a.target_id=o.id AND a.actor_id IS NULL AND a.action='disable' AND a.status='completed'
        WHERE s.id=${sessionId}`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        valid_session_time: true,
        valid_disable_time: true,
        valid_receipt_time: true,
      });
      const row = rows[0]!;
      if (row.disabled_submillisecond) submillisecondSamples.disabled++;
      if (row.revoked_submillisecond) submillisecondSamples.revoked++;
      if (row.receipt_submillisecond) submillisecondSamples.receipt++;
      confirmed.push({ targetId: operatorId, operationId: row.operation_id });
    }
    // Each real DB clock retains microseconds; current operations have ordered, distinct moments.
    expect(submillisecondSamples.disabled).toBeGreaterThan(0);
    expect(submillisecondSamples.revoked).toBeGreaterThan(0);
    expect(submillisecondSamples.receipt).toBeGreaterThan(0);
    // Preserve every receipt if any timing assertion failed. Never broaden the shared reset.
    for (const receipt of confirmed)
      await safe(
        () => fixture.admin.sql`DELETE FROM qf.operator_account_operation
      WHERE operation_id=${receipt.operationId} AND target_id=${receipt.targetId}
        AND actor_id IS NULL AND action='disable' AND status='completed'`,
      );
  });
});
