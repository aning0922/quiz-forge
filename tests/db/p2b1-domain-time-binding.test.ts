import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import {
  openTestDatabase,
  resetTestDatabase,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
import { disableOperator } from "@/lib/db/management";
import { issueToken } from "@/lib/security/p2a-tokens";
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
    let submillisecondSamples = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      const operatorId = randomUUID(),
        sessionId = randomUUID();
      await safe(
        () =>
          fixture.admin
            .sql`INSERT INTO qf.operator(id,label,credential_digest,role,status) VALUES(${operatorId},${`test-${operatorId}`},${issueToken("credential").digest},'operator','active')`,
      );
      await safe(
        () =>
          fixture.app
            .sql`WITH m AS MATERIALIZED(SELECT clock_timestamp() at) INSERT INTO qf.operator_session(id,token_digest,kind,operator_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at) SELECT ${sessionId},${issueToken("session").digest},'authenticated',${operatorId},at,at,at+interval '30 minutes',at+interval '8 hours' FROM m`,
      );
      expect(
        await safe(() =>
          disableOperator(fixture.config.instanceId, operatorId),
        ),
      ).toEqual({ id: operatorId, changed: true });
      const [row] = await safe(
        () => fixture.app.sql`SELECT
    s.revoked_at>=s.created_at valid_session_time,
    o.disabled_at=s.revoked_at same_operator_time,
    a.occurred_at=s.revoked_at same_audit_time,
    mod(EXTRACT(microseconds FROM o.disabled_at)::bigint,1000)<>0 submillisecond_preserved
    FROM qf.operator_session s JOIN qf.operator o ON o.id=s.operator_id
    JOIN qf.audit_event a ON a.actor_id=o.id AND a.action='operator_disabled'
    WHERE s.id=${sessionId}`,
      );
      expect(row).toMatchObject({
        valid_session_time: true,
        same_operator_time: true,
        same_audit_time: true,
      });
      if (row?.submillisecond_preserved) submillisecondSamples++;
    }
    // The previous serializer deterministically produced only millisecond-aligned values.
    expect(submillisecondSamples).toBeGreaterThan(0);
  });
});
