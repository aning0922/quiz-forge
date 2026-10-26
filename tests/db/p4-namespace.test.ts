import { randomUUID, createHash } from "node:crypto";

import { beforeAll, afterAll, expect, it } from "vitest";
import { createDatabase, type P2aDatabase } from "@/lib/db/client";
import { openManagedDatabase } from "@/lib/db/management";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { migrateDatabase, readMigrations } from "@/lib/db/migrate";
import { CONSUMER_CATALOG_QUERY } from "@/lib/db/consumer-catalog";
import { consumerSchemaFacts } from "@/lib/db/consumer-schema-facts";

let admin: Awaited<ReturnType<typeof openManagedDatabase>>;
let app: P2aDatabase;
beforeAll(async () => {
  const config = await loadRuntimeConfig();
  if (!["test", "ci"].includes(config.purpose))
    throw Error("P4_NAMESPACE_FRESH_TEST_REQUIRED");
  admin = await openManagedDatabase(config.instanceId);
  expect(admin.config).toEqual(config);
  app = await createDatabase(config);
});
afterAll(async () => {
  await app?.close();
  await admin?.close();
});
async function catalog() {
  const [r] = await admin.sql.unsafe<{ sha256: string }[]>(
    CONSUMER_CATALOG_QUERY,
  );
  return r?.sha256;
}
async function accepted() {
  const opened = await createDatabase(admin.config);
  await opened.close();
}
// Raw textual rows preserve all old data; catalog ACLs cover the malicious view too.
async function snapshot() {
  const tables = await admin.sql<
    { name: string }[]
  >`SELECT relname name FROM pg_class WHERE relnamespace='qf'::regnamespace AND relkind='r' ORDER BY relname`;
  const rows: Record<string, string[]> = {};
  for (const { name } of tables) {
    const data = await admin.sql<
      { row: string }[]
    >`SELECT row_to_json(t)::text row FROM ${admin.sql(`qf.${name}`)} t ORDER BY row_to_json(t)::text`;
    rows[name] = data.map((r) => r.row);
  }
  const history =
    await admin.sql`SELECT row_to_json(t)::text row FROM qf_meta.schema_migrations t ORDER BY version`;
  const acl =
    await admin.sql`SELECT c.relname,c.relkind,c.relowner,c.relacl,a.attname,a.attacl FROM pg_class c LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 WHERE c.relnamespace='qf'::regnamespace ORDER BY c.relname,a.attnum`;
  const schemas =
    await admin.sql`SELECT nspname,nspowner,nspacl FROM pg_namespace WHERE nspname IN ('qf','qf_meta','public') ORDER BY nspname`;
  const functions =
    await admin.sql`SELECT oid::regprocedure::text name,proacl FROM pg_proc WHERE pronamespace='qf'::regnamespace ORDER BY name`;
  const database =
    await admin.sql`SELECT datacl FROM pg_database WHERE datname=current_database()`;
  return { rows, history, acl, schemas, functions, database };
}
async function refusedWithoutRepair() {
  const before = await snapshot();
  await expect(createDatabase(admin.config)).rejects.toThrow(
    "STUDIO_UNAVAILABLE",
  );
  await expect(migrateDatabase(admin.sql, admin.config)).rejects.toThrow(
    "MIGRATION_FAILED",
  );
  expect(await snapshot()).toEqual(before);
}
async function addView() {
  const role = admin.sql(admin.config.database.user);
  await admin.sql`CREATE VIEW qf.namespace_write_probe AS SELECT id,account_revision FROM qf.operator`;
  await admin.sql`GRANT SELECT,UPDATE(account_revision) ON qf.namespace_write_probe TO ${role}`;
}
it("opens current catalog without rewriting immutable migration 0018", async () => {
  const definitions = await readMigrations();
  const immutable18 = definitions.find(
    (migration) => migration.version === "0018_consumer_session_report",
  );
  expect(immutable18).toBeDefined();
  expect(createHash("sha256").update(immutable18!.source).digest("hex")).toBe(
    "a723d409df2dc1225f4504ff14bc13b18824c93adac28b7f10058c3e586c060a",
  );
  expect(await catalog()).toBe(consumerSchemaFacts.sha256);
  const before = await snapshot();
  expect(await migrateDatabase(admin.sql, admin.config)).toEqual([]);
  expect(await snapshot()).toEqual(before);
  await accepted();
});
it("reproduces the omitted updatable-view write then rejects startup and migration without changing rows/history/ACL", async () => {
  const id = randomUUID();
  const first = 1,
    second = 2;
  await admin.sql`INSERT INTO qf.operator(id,login_name,display_name,account_revision,role,status) VALUES(${id},${`namespace-${id}`},'Namespace fixture',${first},'operator','active')`;
  await addView();
  expect(await catalog()).toBe(consumerSchemaFacts.sha256);
  const [privileges] = await app.sql<
    { direct: boolean; indirect: boolean }[]
  >`SELECT has_column_privilege(current_user,'qf.operator','account_revision','UPDATE') direct,has_column_privilege(current_user,'qf.namespace_write_probe','account_revision','UPDATE') indirect`;
  expect(privileges).toEqual({ direct: false, indirect: true });
  // Deliberately pre-existing client demonstrates the original write path on synthetic data.
  await app.sql`UPDATE qf.namespace_write_probe SET account_revision=${second} WHERE id=${id}`;
  const [changed] =
    await admin.sql`SELECT account_revision FROM qf.operator WHERE id=${id}`;
  expect(changed?.account_revision).toBe(second);
  await refusedWithoutRepair();
  await admin.sql`DROP VIEW qf.namespace_write_probe`;
  await admin.sql`DELETE FROM qf.operator WHERE id=${id} AND account_revision=${second}`;
  await accepted();
});
it("rejects relation/type/rule/policy/schema/default-ACL and other unsupported namespace objects without repair", async () => {
  const role = `"${admin.config.database.user}"`;
  for (const [create, remove] of [
    [
      "CREATE MATERIALIZED VIEW qf.namespace_probe AS SELECT 1 n",
      "DROP MATERIALIZED VIEW qf.namespace_probe",
    ],
    ["CREATE SEQUENCE qf.namespace_probe", "DROP SEQUENCE qf.namespace_probe"],
    [
      "CREATE TABLE qf.namespace_probe(n integer)",
      "DROP TABLE qf.namespace_probe",
    ],
    [
      "CREATE TYPE qf.namespace_probe AS (n integer)",
      "DROP TYPE qf.namespace_probe",
    ],
    [
      "CREATE DOMAIN qf.namespace_probe AS text",
      "DROP DOMAIN qf.namespace_probe",
    ],
    [
      "CREATE TYPE qf.namespace_probe AS ENUM ('extra')",
      "DROP TYPE qf.namespace_probe",
    ],
    [
      "CREATE RULE namespace_probe AS ON UPDATE TO qf.operator DO ALSO NOTHING",
      "DROP RULE namespace_probe ON qf.operator",
    ],
    [
      "CREATE POLICY namespace_probe ON qf.operator USING (true)",
      "DROP POLICY namespace_probe ON qf.operator",
    ],
    [
      `GRANT CREATE ON SCHEMA qf TO ${role}`,
      `REVOKE CREATE ON SCHEMA qf FROM ${role}`,
    ],
    [
      "GRANT USAGE ON SCHEMA qf TO PUBLIC",
      "REVOKE USAGE ON SCHEMA qf FROM PUBLIC",
    ],
    [
      `ALTER DEFAULT PRIVILEGES IN SCHEMA qf GRANT SELECT ON TABLES TO ${role}`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA qf REVOKE SELECT ON TABLES FROM ${role}`,
    ],
    [
      'CREATE COLLATION qf.namespace_probe FROM pg_catalog."C"',
      "DROP COLLATION qf.namespace_probe",
    ],
    [
      "CREATE TEXT SEARCH CONFIGURATION qf.namespace_probe (COPY=pg_catalog.english)",
      "DROP TEXT SEARCH CONFIGURATION qf.namespace_probe",
    ],
    [
      "CREATE STATISTICS qf.namespace_probe ON login_name,role FROM qf.operator",
      "DROP STATISTICS qf.namespace_probe",
    ],
  ]) {
    await admin.sql.unsafe(create!);
    await refusedWithoutRepair();
    // Delete only the exact probe created by this iteration, after assertions succeeded.
    await admin.sql.unsafe(remove!);
    await accepted();
  }
});
