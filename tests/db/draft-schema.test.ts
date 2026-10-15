import { afterAll, beforeAll, expect, it } from "vitest";
import { createDatabase } from "@/lib/db/client";
import { migrateDatabase } from "@/lib/db/migrate";
import { draftSchemaFacts } from "@/lib/db/draft-schema-facts";
import {
  openTestDatabase,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";

let database: TestDatabase;
beforeAll(async () => {
  database = await safe(openTestDatabase);
});
afterAll(async () => {
  await database?.close();
});
async function accepts() {
  const app = await safe(() => createDatabase(database.config));
  await app.close();
}
async function refuses() {
  await expect(createDatabase(database.config)).rejects.toThrow(
    "STUDIO_UNAVAILABLE",
  );
}

it("opens the complete first-draft capability and has no migration replay", async () => {
  await accepts();
  expect(
    await safe(() => migrateDatabase(database.admin.sql, database.config)),
  ).toEqual([]);
});

it("rejects column-level UPDATE and public column read privileges", async () => {
  const sql = database.admin.sql;
  for (const publicRead of [false, true]) {
    try {
      if (publicRead)
        await safe(() => sql`GRANT SELECT(id) ON qf.product_draft TO PUBLIC`);
      else
        await safe(
          () =>
            sql`GRANT UPDATE(created_at) ON qf.product_draft TO ${sql(database.config.database.user)}`,
        );
      await refuses();
    } finally {
      if (publicRead)
        await safe(
          () => sql`REVOKE SELECT(id) ON qf.product_draft FROM PUBLIC`,
        );
      await safe(() => migrateDatabase(sql, database.config));
    }
    await accepts();
  }
});

it("rejects a same-name weakened fingerprint constraint", async () => {
  const sql = database.admin.sql;
  const original = draftSchemaFacts.constraints.find(
    (item) => item.name === "draft_application_fingerprint_exact",
  );
  if (!original) throw new Error("TEST_EXPECTED_CONSTRAINT_REQUIRED");
  await safe(
    () =>
      sql`ALTER TABLE qf.draft_application DROP CONSTRAINT draft_application_fingerprint_exact`,
  );
  try {
    await safe(
      () =>
        sql`ALTER TABLE qf.draft_application ADD CONSTRAINT draft_application_fingerprint_exact CHECK(true)`,
    );
    await refuses();
  } finally {
    await safe(
      () =>
        sql`ALTER TABLE qf.draft_application DROP CONSTRAINT IF EXISTS draft_application_fingerprint_exact`,
    );
    await safe(() =>
      sql.unsafe(
        `ALTER TABLE qf.draft_application ADD CONSTRAINT draft_application_fingerprint_exact ${original.definition}`,
      ),
    );
  }
  await accepts();
});

it("rejects disabled or predicated source enforcement with the exact function body", async () => {
  const sql = database.admin.sql;
  const create = (predicate: boolean) =>
    `CREATE TRIGGER draft_revision_source BEFORE INSERT ON qf.draft_revision FOR EACH ROW ${predicate ? "WHEN (false)" : ""} EXECUTE FUNCTION qf.protect_draft_revision_source()`;
  await safe(
    () =>
      sql`ALTER TABLE qf.draft_revision DISABLE TRIGGER draft_revision_source`,
  );
  try {
    await refuses();
  } finally {
    await safe(
      () =>
        sql`ALTER TABLE qf.draft_revision ENABLE TRIGGER draft_revision_source`,
    );
  }
  await safe(
    () => sql`DROP TRIGGER draft_revision_source ON qf.draft_revision`,
  );
  try {
    await safe(() => sql.unsafe(create(true)));
    await refuses();
  } finally {
    await safe(
      () =>
        sql`DROP TRIGGER IF EXISTS draft_revision_source ON qf.draft_revision`,
    );
    await safe(() => sql.unsafe(create(false)));
  }
  await accepts();
});

it("rejects changed helper strictness without relying only on its unchanged body hash", async () => {
  const sql = database.admin.sql;
  await safe(
    () =>
      sql`ALTER FUNCTION qf.draft_application_fingerprint(text,uuid,uuid,integer,text) CALLED ON NULL INPUT`,
  );
  try {
    await refuses();
  } finally {
    await safe(
      () =>
        sql`ALTER FUNCTION qf.draft_application_fingerprint(text,uuid,uuid,integer,text) STRICT`,
    );
  }
  await accepts();
});
