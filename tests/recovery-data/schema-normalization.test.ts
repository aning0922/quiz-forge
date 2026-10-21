import { afterAll, beforeAll, expect, it } from "vitest";
import type postgres from "postgres";
import {
  initLocalInstance,
  loadManagedInstance,
  manageLocalInstance,
  openManagedDatabase,
} from "@/lib/db/management";
import { createDatabase } from "@/lib/db/client";
import { CONSUMER_CATALOG_QUERY } from "@/lib/db/consumer-catalog";
import { consumerSchemaFacts } from "@/lib/db/consumer-schema-facts";
import {
  normalizeRestoredRecoverySchema,
  PG18_RESTORED_CATALOG_SHA256,
} from "@/features/runtime-recovery/restore-schema";
import { freshBudget } from "../recovery/artifact-fixture";

let id: string;
let db: Awaited<ReturnType<typeof openManagedDatabase>>;
const names = [
  "asset_blob_media_type_check",
  "draft_revision_content_kind_check",
  "draft_revision_content_schema_version_check",
  "draft_revision_engine_id_check",
  "product_asset_purpose_check",
  "quizpack_validation_last_error_code_check",
];
async function hash() {
  const [row] = await db.sql.unsafe<{ sha256: string }[]>(
    CONSUMER_CATALOG_QUERY,
  );
  return row?.sha256;
}
// PostgreSQL deparses the original varchar-array CHECKs and reparses them in
// exactly this way during native pg_restore. This mutates only this test's DB.
async function nativeReparse() {
  expect(await hash()).toBe(consumerSchemaFacts.sha256);
  const checks = await db.sql<
    { table_name: string; name: string; definition: string }[]
  >`
    SELECT conrelid::regclass::text table_name,conname name,pg_get_constraintdef(oid) definition
    FROM pg_constraint WHERE connamespace='qf'::regnamespace AND conname=ANY(${names}) ORDER BY conname`;
  expect(checks).toHaveLength(6);
  await db.sql.begin(async (tx) => {
    for (const c of checks) {
      await tx.unsafe(
        `ALTER TABLE ${c.table_name} DROP CONSTRAINT ${c.name} RESTRICT`,
      );
      await tx.unsafe(
        `ALTER TABLE ${c.table_name} ADD CONSTRAINT ${c.name} ${c.definition}`,
      );
    }
  });
  expect(await hash()).toBe(PG18_RESTORED_CATALOG_SHA256);
}
function observeDdl(
  onDdl: (count: number) => void,
  failAfter?: number,
): postgres.Sql {
  let count = 0;
  // All SQL and transaction rollback still execute against real PostgreSQL.
  return {
    begin: (work: (tx: postgres.TransactionSql) => Promise<void>) =>
      db.sql.begin(async (tx) => {
        const unsafe = tx.unsafe.bind(tx);
        const observed = Object.create(tx) as postgres.TransactionSql;
        observed.unsafe = ((query: string, ...args: unknown[]) => {
          if (query.startsWith("ALTER TABLE")) {
            onDdl(++count);
            if (count === failAfter)
              throw Error("synthetic transaction interruption");
          }
          return unsafe(
            query,
            ...(args as Parameters<typeof unsafe> extends [unknown, ...infer R]
              ? R
              : never),
          );
        }) as typeof tx.unsafe;
        return work(observed);
      }),
  } as unknown as postgres.Sql;
}
beforeAll(async () => {
  id = (
    await initLocalInstance({
      port: 55421,
      origin: "http://127.0.0.1:3198",
      purpose: "test",
    })
  ).instanceId;
  db = await openManagedDatabase(id);
});
afterAll(async () => {
  if (db) await db.close();
  if (id) await manageLocalInstance("stop", id);
});

it("admits only the exact variant, normalizes all six and passes unchanged application guards", async () => {
  await nativeReparse();
  let count = 0;
  await normalizeRestoredRecoverySchema(
    observeDdl((n) => {
      count = n;
    }),
    freshBudget(),
  );
  expect(count).toBe(12);
  expect(await hash()).toBe(consumerSchemaFacts.sha256);
  const app = await createDatabase((await loadManagedInstance(id)).config);
  await app.close();
});

it("refuses unknown constraint and ACL variants with zero DDL and unchanged catalog", async () => {
  for (const [add, remove] of [
    [
      "ALTER TABLE qf.product ADD CONSTRAINT synthetic_extra CHECK (true)",
      "ALTER TABLE qf.product DROP CONSTRAINT synthetic_extra RESTRICT",
    ],
    [
      "GRANT SELECT ON qf.product TO PUBLIC",
      "REVOKE SELECT ON qf.product FROM PUBLIC",
    ],
  ]) {
    await nativeReparse();
    await db.sql.unsafe(add!);
    const before = await hash();
    let count = 0;
    expect(before).not.toBe(PG18_RESTORED_CATALOG_SHA256);
    await expect(
      normalizeRestoredRecoverySchema(
        observeDdl((n) => {
          count = n;
        }),
        freshBudget(),
      ),
    ).rejects.toThrow("RECOVERY_INTEGRITY_FAILED");
    expect(count).toBe(0);
    expect(await hash()).toBe(before);
    await db.sql.unsafe(remove!);
    await normalizeRestoredRecoverySchema(db.sql, freshBudget());
  }
});

it("rolls back actual preceding DDL if the six-check normalization is interrupted", async () => {
  await nativeReparse();
  let count = 0;
  await expect(
    normalizeRestoredRecoverySchema(
      observeDdl((n) => {
        count = n;
      }, 4),
      freshBudget(),
    ),
  ).rejects.toThrow("synthetic transaction interruption");
  expect(count).toBe(4);
  expect(await hash()).toBe(PG18_RESTORED_CATALOG_SHA256);
  const [facts] =
    await db.sql`SELECT count(*)::int n,bool_and(convalidated AND conenforced) valid FROM pg_constraint WHERE connamespace='qf'::regnamespace AND conname=ANY(${names})`;
  expect(facts?.n).toBe(6);
  expect(facts?.valid).toBe(true);
  await normalizeRestoredRecoverySchema(db.sql, freshBudget());
});
