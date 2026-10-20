import {
  beforeAll,
  afterAll,
  beforeEach,
  onTestFailed,
  expect,
  it,
} from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { createDatabase, openSql } from "@/lib/db/client";
import { readMigrations, migrateDatabase } from "@/lib/db/migrate";
import { CONSUMER_CATALOG_QUERY } from "@/lib/db/consumer-catalog";
import { consumerSchemaFacts } from "@/lib/db/consumer-schema-facts";
import { StorageReadGuard } from "@/features/quizpack/resource-read/guard";
import { createProductInternalVersionService } from "@/features/product/internal-versions/service";
import { createInternalVersionOwner } from "@/features/product/internal-versions/lifecycle";
import { createStudioRequestBudget } from "@/lib/http-security/request-budget";
import { openTestDatabase, type TestDatabase } from "./p2a-fixture";
import { resetDomainDatabase } from "./p2b2b-domain-fixture";
import { p4Fixture, readP4OldGraph } from "./p4-fixture";
let db: TestDatabase,
  f: Awaited<ReturnType<typeof p4Fixture>> | undefined,
  failed = false;
beforeEach(() =>
  onTestFailed(() => {
    failed = true;
  }),
);
beforeAll(async () => {
  db = await openTestDatabase();
  await resetDomainDatabase(db);
});
afterAll(async () => {
  try {
    if (f && !failed) await f.cleanup();
  } finally {
    await db?.app.close();
    await db?.close();
  }
});

it("upgrades a real 17 r1/r2/review/version/shared-blob lineage byte-for-byte and matches fresh 18 facts", async () => {
  const definitions = await readMigrations();
  expect(definitions.at(-1)?.version).toBe("0018_consumer_session_report");
  await db.app.close();
  // Only this marker-verified, purpose=test/ci, confirmed empty no-file fixture may be restaged.
  await db.admin.sql`DROP SCHEMA qf CASCADE`;
  await db.admin.sql`DROP SCHEMA qf_meta CASCADE`;
  await migrateDatabase(db.admin.sql, db.config, definitions.slice(0, 17));
  await expect(createDatabase(db.config)).rejects.toThrow("STUDIO_UNAVAILABLE");
  // Explicit old-writer test scaffold; no runtime capability bypass is exported to application code.
  const oldSql = openSql(db.config.database);
  const [identity] = await oldSql<
    { database: string; role: string; version: number }[]
  >`SELECT current_database() database,current_user role,current_setting('server_version_num')::integer version`;
  expect(identity).toEqual({
    database: db.config.database.name,
    role: db.config.database.user,
    version: 180004,
  });
  db.app = {
    sql: oldSql,
    db: drizzle(oldSql, { schema }),
    config: db.config,
    close: () => oldSql.end({ timeout: 1 }),
  };
  f = await p4Fixture(db, false, true);
  const before = await readP4OldGraph(db.admin.sql);
  expect(Object.keys(before)).toHaveLength(16);
  expect(before.draft_revision).toHaveLength(2);
  expect(before.draft_review).toHaveLength(1);
  expect(before.product_version).toHaveLength(1);
  const revisions = before.draft_revision!.map(
    (text) => JSON.parse(text) as { revision: number; asset_set_text: string },
  );
  const blobs = revisions.map(
    (r) =>
      new Set(
        (
          JSON.parse(r.asset_set_text) as {
            resources: { blobSha256: string }[];
          }
        ).resources.map((a) => a.blobSha256),
      ),
  );
  expect([...blobs[0]!].some((sha) => blobs[1]!.has(sha))).toBe(true);
  expect(JSON.parse(before.product_draft![0]!).current_revision).toBe(2);
  expect(f.parent.snapshot.target.revision).toBe(1);
  const history = await db.admin
    .sql`SELECT version,checksum,applied_at FROM qf_meta.schema_migrations ORDER BY version`;
  await expect(
    migrateDatabase(db.admin.sql, db.config, definitions),
  ).rejects.toThrow("MIGRATION_FAILED");
  await db.app.close();
  for (let i = 0; i < 100; i++) {
    const [r] = await db.admin.sql<
      { count: number }[]
    >`SELECT count(*)::integer count FROM pg_stat_activity WHERE datname=current_database() AND usename=${db.config.database.user}`;
    if (r?.count === 0) break;
    if (i === 99) throw Error("P4_TEST_OLD_WRITER_UNCONFIRMED");
    await new Promise((r) => setTimeout(r, 10));
  }
  const guard = await StorageReadGuard.acquire(
    db.config,
    () => {},
    performance.now() + 15000,
  );
  try {
    await expect(
      migrateDatabase(db.admin.sql, db.config, definitions),
    ).rejects.toThrow("MIGRATION_FAILED");
  } finally {
    await guard.close();
  }
  for (let i = 0; i < 100; i++) {
    const [r] = await db.admin.sql<
      { count: number }[]
    >`SELECT count(*)::integer count FROM pg_stat_activity WHERE datname=current_database() AND usename=${db.config.database.user}`;
    if (r?.count === 0) break;
    if (i === 99) throw Error("P4_TEST_GUARD_CLOSE_UNCONFIRMED");
    await new Promise((r) => setTimeout(r, 10));
  }
  const [constraint] = await db.admin.sql<
    { definition: string }[]
  >`SELECT pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='qf.product_version'::regclass AND conname='product_version_slot_check'`;
  if (!constraint) throw Error("P4_TEST_CONSTRAINT_MISSING");
  await db.admin
    .sql`ALTER TABLE qf.product_version DROP CONSTRAINT product_version_slot_check`;
  try {
    await db.admin
      .sql`ALTER TABLE qf.product_version ADD CONSTRAINT product_version_slot_check CHECK(slot>0)`;
    await expect(
      migrateDatabase(db.admin.sql, db.config, definitions),
    ).rejects.toThrow("MIGRATION_FAILED");
  } finally {
    await db.admin
      .sql`ALTER TABLE qf.product_version DROP CONSTRAINT product_version_slot_check`;
    await db.admin.sql.unsafe(
      `ALTER TABLE qf.product_version ADD CONSTRAINT product_version_slot_check ${constraint.definition}`,
    );
  }
  expect(await readP4OldGraph(db.admin.sql)).toEqual(before);
  expect(await migrateDatabase(db.admin.sql, db.config, definitions)).toEqual([
    "0018_consumer_session_report",
  ]);
  expect(await readP4OldGraph(db.admin.sql)).toEqual(before);
  expect(
    await db.admin
      .sql`SELECT version,checksum,applied_at FROM qf_meta.schema_migrations WHERE version<>'0018_consumer_session_report' ORDER BY version`,
  ).toEqual(history);
  db.app = await createDatabase(db.config);
  const [catalog] = await db.app.sql.unsafe<{ sha256: string }[]>(
    CONSUMER_CATALOG_QUERY,
  );
  expect(catalog?.sha256).toBe(consumerSchemaFacts.sha256);
  const clock = createStudioRequestBudget(new AbortController().signal);
  const owner = createInternalVersionOwner(db.app, clock);
  try {
    const service = createProductInternalVersionService(owner);
    expect(
      await service.readVersion(
        db.app,
        f.auth.session.raw,
        f.playRef.productId,
        f.parent.version.id,
      ),
    ).toEqual(f.parent);
    const resolved = await service.resolveVersion(
      db.app,
      f.auth.session.raw,
      f.parent.version.binding,
    );
    expect(resolved.kind).toBe("sealed");
    if (resolved.kind === "sealed")
      expect(resolved.version).toEqual(f.parent.version);
  } finally {
    await owner.closeIfNotTransferred();
  }
  db.app = await createDatabase(db.config);
  expect(await readP4OldGraph(db.admin.sql)).toEqual(before);
  expect(await migrateDatabase(db.admin.sql, db.config, definitions)).toEqual(
    [],
  );
});
