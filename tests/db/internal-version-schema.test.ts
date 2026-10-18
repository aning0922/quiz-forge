import { afterAll, beforeAll, expect, it } from "vitest";
import { createDatabase } from "@/lib/db/client";
import { migrateDatabase } from "@/lib/db/migrate";
import { internalVersionSchemaFacts } from "@/lib/db/internal-version-schema-facts";
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

it("opens both exact immutable ledgers and replay does not rewrite migration history", async () => {
  await accepts();
  expect(
    await safe(() => migrateDatabase(database.admin.sql, database.config)),
  ).toEqual([]);
});
it("rejects added write privileges, including column-only grants and PUBLIC reads", async () => {
  const sql = database.admin.sql;
  for (const table of ["draft_review", "product_version"]) {
    for (const grant of ["UPDATE(id)", "DELETE", "SELECT(id)"]) {
      const role =
        grant === "SELECT(id)"
          ? "PUBLIC"
          : `"${database.config.database.user}"`;
      try {
        await safe(() =>
          sql.unsafe(`GRANT ${grant} ON qf.${table} TO ${role}`),
        );
        await refuses();
      } finally {
        await safe(() => migrateDatabase(sql, database.config));
      }
      await accepts();
    }
  }
});
it("rejects changed slot nullability/default, so 100-slot proofs cannot silently weaken", async () => {
  const sql = database.admin.sql;
  for (const alteration of ["DROP NOT NULL", "SET DEFAULT 1"]) {
    try {
      await safe(() =>
        sql.unsafe(
          `ALTER TABLE qf.product_version ALTER COLUMN slot ${alteration}`,
        ),
      );
      await refuses();
    } finally {
      await safe(
        () =>
          sql`ALTER TABLE qf.product_version ALTER COLUMN slot SET NOT NULL`,
      );
      await safe(
        () =>
          sql`ALTER TABLE qf.product_version ALTER COLUMN slot DROP DEFAULT`,
      );
    }
    await accepts();
  }
});
it("rejects same-name weakened text/capacity constraints", async () => {
  const sql = database.admin.sql;
  for (const name of [
    "product_version_slot_check",
    "product_version_text_exact",
  ]) {
    const original = internalVersionSchemaFacts.constraints.find(
      (c) => c.name === name,
    )!;
    await safe(() =>
      sql.unsafe(`ALTER TABLE qf.product_version DROP CONSTRAINT ${name}`),
    );
    try {
      await safe(() =>
        sql.unsafe(
          `ALTER TABLE qf.product_version ADD CONSTRAINT ${name} CHECK(true)`,
        ),
      );
      await refuses();
    } finally {
      await safe(() =>
        sql.unsafe(`ALTER TABLE qf.product_version DROP CONSTRAINT ${name}`),
      );
      await safe(() =>
        sql.unsafe(
          `ALTER TABLE qf.product_version ADD CONSTRAINT ${name} ${original.definition}`,
        ),
      );
    }
    await accepts();
  }
});
it("rejects disabled source enforcement and changed helper attributes or PUBLIC execute", async () => {
  const sql = database.admin.sql;
  try {
    await safe(
      () =>
        sql`ALTER TABLE qf.draft_review DISABLE TRIGGER draft_review_source`,
    );
    await refuses();
  } finally {
    await safe(
      () => sql`ALTER TABLE qf.draft_review ENABLE TRIGGER draft_review_source`,
    );
  }
  for (const alteration of ["STABLE", "CALLED ON NULL INPUT"]) {
    try {
      await safe(() =>
        sql.unsafe(`ALTER FUNCTION qf.internal_canonical(jsonb) ${alteration}`),
      );
      await refuses();
    } finally {
      await safe(
        () => sql`ALTER FUNCTION qf.internal_canonical(jsonb) IMMUTABLE STRICT`,
      );
    }
  }
  try {
    await safe(
      () =>
        sql`GRANT EXECUTE ON FUNCTION qf.internal_canonical(jsonb) TO PUBLIC`,
    );
    await refuses();
  } finally {
    await safe(
      () =>
        sql`REVOKE EXECUTE ON FUNCTION qf.internal_canonical(jsonb) FROM PUBLIC`,
    );
  }
  await accepts();
});
