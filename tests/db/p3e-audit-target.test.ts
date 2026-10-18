import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  openTestDatabase,
  authenticateTestOperator,
  type TestDatabase,
} from "./p2a-fixture";
import { resetDomainDatabase } from "./p2b2b-domain-fixture";
let db: TestDatabase,
  auth: Awaited<ReturnType<typeof authenticateTestOperator>>,
  sessionId: string;
beforeAll(async () => {
  db = await openTestDatabase();
  await resetDomainDatabase(db);
  auth = await authenticateTestOperator(db);
  const [session] = await db.app.sql<
    { id: string }[]
  >`SELECT id FROM qf.operator_session WHERE operator_id=${auth.id} AND kind='authenticated' AND revoked_at IS NULL`;
  if (!session) throw Error("SYNTHETIC_AUDIT_SESSION_REQUIRED");
  sessionId = session.id;
});
afterAll(async () => {
  if (db) {
    await resetDomainDatabase(db);
    await db.close();
  }
});
const actions = [
  ["draft_baseline_recorded", "review"],
  ["internal_version_sealed", "version"],
] as const;
for (const [action, kind] of actions) {
  it.each(["kind", "revision"] as const)(
    `rejects ${action} with missing target %s rather than accepting SQL NULL`,
    async (missing) => {
      const id = randomUUID();
      await expect(
        db.app
          .sql`INSERT INTO qf.audit_event(id,occurred_at,action,outcome,actor_id,session_id,request_id,target_kind,target_id,target_revision) VALUES(${id},clock_timestamp(),${action},'success',${auth.id},${sessionId},${randomUUID()},${missing === "kind" ? null : kind},${randomUUID()},${missing === "revision" ? null : 1})`,
      ).rejects.toMatchObject({
        code: "23514",
        constraint_name: "audit_target",
      });
      const [row] = await db.app.sql<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM qf.audit_event WHERE id=${id}`;
      expect(row?.n).toBe(0);
    },
  );
  it(`accepts the complete finite ${action} audit target`, async () => {
    const id = randomUUID();
    await db.app
      .sql`INSERT INTO qf.audit_event(id,occurred_at,action,outcome,actor_id,session_id,request_id,target_kind,target_id,target_revision) VALUES(${id},clock_timestamp(),${action},'success',${auth.id},${sessionId},${randomUUID()},${kind},${randomUUID()},1)`;
    const [row] = await db.app.sql<
      { n: number }[]
    >`SELECT count(*)::int AS n FROM qf.audit_event WHERE id=${id}`;
    expect(row?.n).toBe(1);
  });
}
