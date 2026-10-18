import { beforeAll, afterAll, expect, it } from "vitest";
import { createDatabase } from "@/lib/db/client";
import { CONSUMER_CATALOG_QUERY } from "@/lib/db/consumer-catalog";
import { consumerSchemaFacts } from "@/lib/db/consumer-schema-facts";
import { consumerCanonicalText } from "@/lib/consumer-contract/v1/integrity";
import { persistedReportFixture } from "@/features/report/persisted/contracts.test-support";
import { internalPlayFixture } from "@/features/product/internal-play/contracts.test-support";
import { openTestDatabase, type TestDatabase } from "./p2a-fixture";
let db: TestDatabase;
beforeAll(async () => {
  db = await openTestDatabase();
});
afterAll(async () => {
  await db?.close();
});
async function refused() {
  await expect(createDatabase(db.config)).rejects.toThrow("STUDIO_UNAVAILABLE");
}
async function accepted() {
  const app = await createDatabase(db.config);
  await app.close();
}

it("opens only the exact 22-table PG18 catalog and the permanent budget row", async () => {
  const [r] = await db.app.sql.unsafe<{ sha256: string }[]>(
    CONSUMER_CATALOG_QUERY,
  );
  expect(r?.sha256).toBe(consumerSchemaFacts.sha256);
  await accepted();
});
it("matches actual protocol canonical JSON and all reviewed persisted structural shapes", async () => {
  const { play } = await internalPlayFixture();
  const { snapshot } = await persistedReportFixture();
  for (const [kind, value] of [
    ["play", play.snapshot],
    ["play_binding", play.play.binding],
    ["report", snapshot],
    ["complete", snapshot.binding],
  ] as const) {
    const text = consumerCanonicalText(value, 524288);
    const [r] = await db.app.sql<
      { text: string; valid: boolean }[]
    >`SELECT qf.consumer_canonical(${text}::jsonb) text,qf.consumer_body_valid(${text},${kind},524288) valid`;
    expect(r?.text).toBe(text);
    expect(r?.valid, kind).toBe(true);
  }
  for (const value of [
    { text: "中文“原文”\n\\\t\u2028😀" },
    { value: 1 },
    { value: 0 },
  ]) {
    const text = consumerCanonicalText(value, 4096);
    const [r] = await db.app.sql<
      { text: string }[]
    >`SELECT qf.consumer_canonical(${text}::jsonb) text`;
    expect(r?.text).toBe(text);
  }
});
it("does not let missing keys, JSON null, noncanonical numbers or extra authority pass SQL validation", async () => {
  const { play } = await internalPlayFixture();
  const values = [
    { ...play.play.binding, operationKey: null },
    { ...play.play.binding, parent: null },
    { ...play.play.binding, rawKey: "synthetic-forbidden" },
  ];
  const missing: Record<string, unknown> = { ...play.play.binding };
  delete missing.renderer;
  values.push(missing as never);
  for (const value of values) {
    const [r] = await db.app.sql<
      { valid: boolean }[]
    >`SELECT qf.consumer_body_valid(${JSON.stringify(value)},'play_binding',8192) valid`;
    expect(r?.valid).toBe(false);
  }
  for (const text of [
    '{"schemaVersion":"quizforge.consumer-state-progress.v1","progress":{}}',
    '{"schemaVersion":"quizforge.consumer-state-progress.v1","progress":{"questionId":false}}',
    '{"schemaVersion":"quizforge.consumer-state-answers.v1","answers":null}',
  ]) {
    const [r] = await db.app.sql<
      { valid: boolean }[]
    >`SELECT qf.consumer_body_valid(${text},${text.includes("answers") ? "answers" : "progress"},65536) valid`;
    expect(r?.valid).toBe(false);
  }
  const [normalized] = await db.app.sql<
    { text: string }[]
  >`SELECT qf.consumer_canonical('{"a":1.0,"b":-0.0,"c":1e2}'::jsonb) text`;
  expect(normalized?.text).toBe('{"a":1,"b":0,"c":100}');
});
it("rejects a same-name weakened check and restores exact capability", async () => {
  try {
    await db.admin
      .sql`ALTER TABLE qf.consumer_session DROP CONSTRAINT consumer_session_text_exact`;
    await db.admin
      .sql`ALTER TABLE qf.consumer_session ADD CONSTRAINT consumer_session_text_exact CHECK(true)`;
    await refused();
  } finally {
    await db.admin
      .sql`ALTER TABLE qf.consumer_session DROP CONSTRAINT consumer_session_text_exact`;
    await db.admin
      .sql`ALTER TABLE qf.consumer_session ADD CONSTRAINT consumer_session_text_exact CHECK(qf.consumer_session_valid(consumer_session) IS TRUE)`;
  }
  await accepted();
});
it("rejects app column-only excess privileges, PUBLIC reads and changed helper security", async () => {
  const role = db.admin.sql(db.config.database.user);
  try {
    await db.admin.sql`GRANT UPDATE(expires_at) ON qf.access_key TO ${role}`;
    await refused();
  } finally {
    await db.admin.sql`REVOKE UPDATE(expires_at) ON qf.access_key FROM ${role}`;
  }
  try {
    await db.admin.sql`GRANT SELECT(id) ON qf.quiz_report TO PUBLIC`;
    await refused();
  } finally {
    await db.admin.sql`REVOKE SELECT(id) ON qf.quiz_report FROM PUBLIC`;
  }
  try {
    await db.admin
      .sql`ALTER FUNCTION qf.consumer_canonical(jsonb) SECURITY DEFINER`;
    await refused();
  } finally {
    await db.admin
      .sql`ALTER FUNCTION qf.consumer_canonical(jsonb) SECURITY INVOKER`;
  }
  await accepted();
});
it("refuses missing budget state without repairing it", async () => {
  const rows = await db.admin.sql`SELECT * FROM qf.consumer_exchange_budget`;
  try {
    await db.admin.sql`DELETE FROM qf.consumer_exchange_budget`;
    await refused();
  } finally {
    await db.admin
      .sql`INSERT INTO qf.consumer_exchange_budget ${db.admin.sql(rows)}`;
  }
  await accepted();
});
it("keeps the report final FK nondeferrable RESTRICT and notices weakened FK or source enforcement", async () => {
  const [fk] = await db.admin.sql<
    { condeferrable: boolean; confupdtype: string; confdeltype: string }[]
  >`SELECT condeferrable,confupdtype,confdeltype FROM pg_constraint WHERE conrelid='qf.quiz_report'::regclass AND conname='quiz_report_session_final'`;
  expect(fk).toEqual({
    condeferrable: false,
    confupdtype: "r",
    confdeltype: "r",
  });
  try {
    await db.admin
      .sql`ALTER TABLE qf.quiz_report ALTER CONSTRAINT quiz_report_session_final DEFERRABLE INITIALLY DEFERRED`;
    await refused();
  } finally {
    await db.admin
      .sql`ALTER TABLE qf.quiz_report ALTER CONSTRAINT quiz_report_session_final NOT DEFERRABLE INITIALLY IMMEDIATE`;
  }
  await accepted();
  try {
    await db.admin
      .sql`ALTER TABLE qf.quiz_report DISABLE TRIGGER consumer_report_source`;
    await refused();
  } finally {
    await db.admin
      .sql`ALTER TABLE qf.quiz_report ENABLE TRIGGER consumer_report_source`;
  }
  await accepted();
});
