import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  openTestDatabase,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
import { resetDomainDatabase } from "./p2b2b-domain-fixture";
import { createDatabase, verifyDatabaseIdentity } from "@/lib/db/client";
import { migrateDatabase } from "@/lib/db/migrate";
import { readFile } from "node:fs/promises";
let db: TestDatabase;
beforeAll(async () => {
  db = await safe(openTestDatabase);
});
beforeEach(async () => {
  await resetDomainDatabase(db);
});
afterAll(async () => {
  await db?.close();
});
const refuses = async () => {
  await expect(createDatabase(db.config)).rejects.toThrow("STUDIO_UNAVAILABLE");
};
const restore = () => safe(() => migrateDatabase(db.admin.sql, db.config));
describe("B2-2B application connection verifies schema and precise privileges early", () => {
  it("disabled ACK trigger, missing validated CHECK and same-signature old helper are refused", async () => {
    await safe(
      () =>
        db.admin
          .sql`ALTER TABLE qf.quizpack_validation DISABLE TRIGGER protect_validation_file_stop_ack`,
    );
    try {
      await refuses();
    } finally {
      await safe(
        () =>
          db.admin
            .sql`ALTER TABLE qf.quizpack_validation ENABLE TRIGGER protect_validation_file_stop_ack`,
      );
    }
    await safe(
      () =>
        db.admin
          .sql`ALTER TABLE qf.quizpack_validation DROP CONSTRAINT validation_file_stop_controls`,
    );
    try {
      await refuses();
    } finally {
      await safe(
        () =>
          db.admin
            .sql`ALTER TABLE qf.quizpack_validation ADD CONSTRAINT validation_file_stop_controls CHECK(qf.validation_file_stop_controls_valid(archive_policy_version,id,attempts_text,evidence_metadata_text))`,
      );
    }
    const source = await readFile(
      "migrations/p2a/0012_validation_file_stop_ack.sql",
      "utf8",
    );
    const definition = source.slice(
      source.indexOf("CREATE OR REPLACE FUNCTION qf.validation_attempts_valid"),
      source.indexOf("CREATE OR REPLACE FUNCTION qf.protect_validation()"),
    );
    await safe(() =>
      db.admin.sql.unsafe(
        "CREATE OR REPLACE FUNCTION qf.validation_attempts_valid(t text,f integer,current_id uuid,reserved bigint) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT true $$",
      ),
    );
    try {
      await refuses();
    } finally {
      await safe(() => db.admin.sql.unsafe(definition));
    }
  });
  it("accepts complete migrated schema and preserves owner verification", async () => {
    const app = await safe(() => createDatabase(db.config));
    await app.close();
    await safe(() =>
      verifyDatabaseIdentity(
        db.admin.sql,
        db.config,
        `qf_owner_${db.config.instanceId}`,
      ),
    );
  });
  it("missing table is refused early; owner still works and can restore", async () => {
    await safe(
      () =>
        db.admin
          .sql`ALTER TABLE qf.product_asset RENAME TO synthetic_missing_product_asset`,
    );
    try {
      await refuses();
      await safe(() =>
        verifyDatabaseIdentity(
          db.admin.sql,
          db.config,
          `qf_owner_${db.config.instanceId}`,
        ),
      );
    } finally {
      await safe(
        () =>
          db.admin
            .sql`ALTER TABLE qf.synthetic_missing_product_asset RENAME TO product_asset`,
      );
    }
  });
  it("missing required column and incorrect column type are refused", async () => {
    await safe(
      () =>
        db.admin
          .sql`ALTER TABLE qf.asset_blob RENAME COLUMN width TO synthetic_width`,
    );
    try {
      await refuses();
    } finally {
      await safe(
        () =>
          db.admin
            .sql`ALTER TABLE qf.asset_blob RENAME COLUMN synthetic_width TO width`,
      );
    }
    await safe(
      () =>
        db.admin
          .sql`ALTER TABLE qf.asset_blob ALTER COLUMN storage_key TYPE varchar(97)`,
    );
    try {
      await refuses();
    } finally {
      await safe(
        () =>
          db.admin
            .sql`ALTER TABLE qf.asset_blob ALTER COLUMN storage_key TYPE varchar(96)`,
      );
    }
  });
  it("missing SELECT/INSERT or mutable-column UPDATE fails closed", async () => {
    const app = db.admin.sql(db.config.database.user);
    for (const action of ["select", "insert", "status"] as const) {
      if (action === "select")
        await safe(
          () => db.admin.sql`REVOKE SELECT ON qf.asset_blob FROM ${app}`,
        );
      if (action === "insert")
        await safe(
          () => db.admin.sql`REVOKE INSERT ON qf.product_asset FROM ${app}`,
        );
      if (action === "status")
        await safe(
          () =>
            db.admin
              .sql`REVOKE UPDATE(status) ON qf.quizpack_validation FROM ${app}`,
        );
      try {
        await refuses();
      } finally {
        await restore();
      }
    }
  });
  it("immutable-column/table UPDATE and product_asset destructive grants are refused", async () => {
    const app = db.admin.sql(db.config.database.user);
    const changes = [
      () =>
        db.admin
          .sql`GRANT UPDATE(identity_text) ON qf.quizpack_validation TO ${app}`,
      () => db.admin.sql`GRANT UPDATE ON qf.quizpack_validation TO ${app}`,
      () => db.admin.sql`GRANT DELETE ON qf.product_asset TO ${app}`,
      () => db.admin.sql`GRANT TRUNCATE ON qf.asset_blob TO ${app}`,
    ];
    for (const change of changes) {
      await safe(change);
      try {
        await refuses();
      } finally {
        await restore();
      }
    }
  });
  it("required helper execute and forbidden trigger helper execute are audited", async () => {
    const app = db.admin.sql(db.config.database.user);
    await safe(
      () =>
        db.admin
          .sql`REVOKE EXECUTE ON FUNCTION qf.sha256_utf8(text) FROM ${app}`,
    );
    try {
      await refuses();
    } finally {
      await restore();
    }
    await safe(
      () =>
        db.admin
          .sql`GRANT EXECUTE ON FUNCTION qf.protect_validation() TO ${app}`,
    );
    try {
      await refuses();
    } finally {
      await restore();
    }
  });
});
