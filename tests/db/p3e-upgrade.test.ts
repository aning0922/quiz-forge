import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  openTestDatabase,
  authenticateTestOperator,
  type TestDatabase,
} from "./p2a-fixture";
import { resetDomainDatabase } from "./p2b2b-domain-fixture";
import { prepareP3dSource } from "./p3d-source-fixture";
import { seedReadyP2b3Source } from "./p2b3-fixture";
import { createDatabase, openSql } from "@/lib/db/client";
import { readMigrations, migrateDatabase } from "@/lib/db/migrate";
import { draftSchemaFacts } from "@/lib/db/draft-schema-facts";
import * as schema from "@/lib/db/schema";
import { createProductDraftService } from "@/features/product/drafts/service";
import { createProductDraftRevisionService } from "@/features/product/draft-revisions/service";
import { StorageReadGuard } from "@/features/quizpack/resource-read/guard";
let db: TestDatabase;
beforeAll(async () => {
  db = await openTestDatabase();
  await resetDomainDatabase(db);
});
afterAll(async () => {
  if (db) {
    await resetDomainDatabase(db);
    await db.close();
  }
});
async function rows() {
  const tables = await db.admin.sql<
    { name: string }[]
  >`SELECT c.relname AS name FROM pg_class c WHERE c.relnamespace='qf'::regnamespace AND c.relkind='r' AND c.relname NOT IN ('draft_review','product_version','internal_play_version','access_key','consumer_session','consumer_grant','quiz_report','consumer_exchange_budget') ORDER BY c.relname`;
  const result: Record<string, string[]> = {};
  for (const { name } of tables) {
    const data = await db.admin.sql<
      { row: string }[]
    >`SELECT row_to_json(t)::text AS row FROM ${db.admin.sql(`qf.${name}`)} t`;
    result[name] = data.map((x) => x.row).sort();
  }
  return result;
}
it("upgrades a real 0016 r1→r2→r3 lineage without changing a byte; rejects active readers/writers and weakened old constraints", async () => {
  const definitions = await readMigrations();
  expect(definitions[15]!.version).toBe("0016_draft_revisions");
  expect(definitions[16]!.version).toBe("0017_internal_versions");
  await db.app.close();
  // Only the marker-verified, purpose=test/ci, empty no-file fixture above may be restaged.
  await db.admin.sql`DROP SCHEMA qf CASCADE`;
  await db.admin.sql`DROP SCHEMA qf_meta CASCADE`;
  try {
    await migrateDatabase(db.admin.sql, db.config, definitions.slice(0, 16));
    await expect(createDatabase(db.config)).rejects.toThrow(
      "STUDIO_UNAVAILABLE",
    );
    // A test-only old-writer connection, never an application capability bypass/export.
    const sql = openSql(db.config.database);
    const [identity] = await sql<
      { database: string; role: string; version: number }[]
    >`SELECT current_database() AS database,current_user AS role,current_setting('server_version_num')::int AS version`;
    expect(identity).toEqual({
      database: db.config.database.name,
      role: db.config.database.user,
      version: 180004,
    });
    db.app = {
      sql,
      db: drizzle(sql, { schema }),
      config: db.config,
      close: () => sql.end({ timeout: 1 }),
    };
    const auth = await authenticateTestOperator(db),
      runId = randomUUID(),
      productId = `p3e-upgrade-${runId}`;
    const first = createProductDraftService(),
      append = createProductDraftRevisionService();
    const initialSource = await seedReadyP2b3Source(
      db,
      auth,
      await prepareP3dSource(productId, 1, runId),
    );
    const initial = await first.applyReadyValidation(
      db.app,
      auth.credentials,
      initialSource.scope,
      initialSource.input,
    );
    let current: {
      draftId: string;
      revision: number;
      canonicalContentSha256: string;
      assetSetSha256: string;
    } = initial.application;
    for (const ordinal of [2, 3]) {
      const source = await seedReadyP2b3Source(
        db,
        auth,
        await prepareP3dSource(productId, ordinal, runId),
        { createProduct: false },
      );
      const next = await append.appendReadyValidation(
        db.app,
        auth.credentials,
        source.scope,
        {
          idempotencyKey: randomUUID(),
          expectedValidationStateRevision:
            source.input.expectedValidationStateRevision,
          expectedCandidateSha256: source.input.expectedCandidateSha256,
          target: {
            kind: "append-revision",
            draftId: current.draftId,
            expectedRevision: current.revision,
            expectedCanonicalContentSha256: current.canonicalContentSha256,
            expectedAssetSetSha256: current.assetSetSha256,
          },
        },
      );
      current = next.application;
    }
    expect(current.revision).toBe(3);
    await expect(
      migrateDatabase(db.admin.sql, db.config, definitions),
    ).rejects.toThrow("MIGRATION_FAILED");
    await db.app.close();
    const before = await rows();
    expect(Object.keys(before)).toHaveLength(14);
    expect(before.draft_revision).toHaveLength(3);
    expect(before.asset_blob).toHaveLength(5);
    const constraint = draftSchemaFacts.constraints.find(
      (c) => c.name === "draft_revision_revision_check",
    )!;
    await db.admin
      .sql`ALTER TABLE qf.draft_revision DROP CONSTRAINT draft_revision_revision_check`;
    await db.admin
      .sql`ALTER TABLE qf.draft_revision ADD CONSTRAINT draft_revision_revision_check CHECK(revision>0)`;
    try {
      await expect(
        migrateDatabase(db.admin.sql, db.config, definitions),
      ).rejects.toThrow("MIGRATION_FAILED");
    } finally {
      await db.admin
        .sql`ALTER TABLE qf.draft_revision DROP CONSTRAINT draft_revision_revision_check`;
      await db.admin.sql.unsafe(
        `ALTER TABLE qf.draft_revision ADD CONSTRAINT draft_revision_revision_check ${constraint.definition}`,
      );
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
    expect(await rows()).toEqual(before);
    expect(await migrateDatabase(db.admin.sql, db.config, definitions)).toEqual(
      ["0017_internal_versions", "0018_consumer_session_report"],
    );
    expect(await rows()).toEqual(before);
    db.app = await createDatabase(db.config);
    const replay = await first.applyReadyValidation(
      db.app,
      auth.credentials,
      initialSource.scope,
      initialSource.input,
    );
    expect(replay).toEqual({ ...initial, created: false });
    const [ledger] = await db.app.sql<
      { n: number }[]
    >`SELECT (SELECT count(*) FROM qf.draft_review)+(SELECT count(*) FROM qf.product_version) AS n`;
    expect(Number(ledger?.n)).toBe(0);
    expect(await migrateDatabase(db.admin.sql, db.config, definitions)).toEqual(
      [],
    );
  } finally {
    await db.app.close();
    await migrateDatabase(db.admin.sql, db.config, definitions);
    db.app = await createDatabase(db.config);
  }
});
