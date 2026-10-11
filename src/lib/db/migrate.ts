import "server-only";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type postgres from "postgres";
import { verifyDatabaseIdentity } from "./client";
import type { P2aRuntimeConfig } from "./runtime";

export type Migration = { version: string; source: string };
export class MigrationError extends Error {
  constructor(
    readonly code:
      | "MIGRATION_CHECKSUM_MISMATCH"
      | "MIGRATION_HISTORY_MISMATCH"
      | "MIGRATION_FAILED",
  ) {
    super(code);
  }
}
export async function readMigrations(
  root = process.cwd(),
): Promise<Migration[]> {
  const dir = path.join(root, "migrations", "p2a");
  const names = (await readdir(dir)).sort();
  if (
    !names.length ||
    names.some((name) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(name))
  )
    throw new MigrationError("MIGRATION_HISTORY_MISMATCH");
  const migrations = await Promise.all(
    names.map(async (name) => ({
      version: name.slice(0, -4),
      source: await readFile(path.join(dir, name), "utf8"),
    })),
  );
  if (new Set(names.map((n) => n.slice(0, 4))).size !== names.length)
    throw new MigrationError("MIGRATION_HISTORY_MISMATCH");
  return migrations;
}

// Session-level lock pins the connection through all version transactions and privilege updates.
export async function migrateDatabase(
  sql: postgres.Sql,
  config: P2aRuntimeConfig,
  migrations?: Migration[],
): Promise<string[]> {
  await verifyDatabaseIdentity(sql, config, `qf_owner_${config.instanceId}`);
  const connection = await sql.reserve();
  let locked = false;
  try {
    await connection`SELECT pg_advisory_lock(716238419221::bigint)`;
    locked = true;
    await transaction(connection, async (tx) => {
      await tx`CREATE SCHEMA IF NOT EXISTS qf_meta`;
      await tx`REVOKE ALL ON SCHEMA qf_meta FROM PUBLIC`;
      await tx`CREATE TABLE IF NOT EXISTS qf_meta.schema_migrations (
        version varchar(128) PRIMARY KEY, checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'), applied_at timestamptz NOT NULL DEFAULT now())`;
      await tx`REVOKE ALL ON qf_meta.schema_migrations FROM PUBLIC`;
    });
    const definitions = migrations ?? (await readMigrations());
    const history = await connection<
      { version: string; checksum: string }[]
    >`SELECT version,checksum FROM qf_meta.schema_migrations ORDER BY version`;
    if (
      history.length > definitions.length ||
      history.some((h, i) => definitions[i]?.version !== h.version)
    )
      throw new MigrationError("MIGRATION_HISTORY_MISMATCH");
    const applied: string[] = [];
    for (const migration of definitions) {
      const checksum = createHash("sha256")
        .update(migration.source, "utf8")
        .digest("hex");
      const existing = history.find((h) => h.version === migration.version);
      if (existing) {
        if (existing.checksum !== checksum)
          throw new MigrationError("MIGRATION_CHECKSUM_MISMATCH");
        continue;
      }
      await transaction(connection, async (tx) => {
        await tx.unsafe(migration.source);
        await tx`INSERT INTO qf_meta.schema_migrations(version,checksum) VALUES(${migration.version},${checksum})`;
      });
      applied.push(migration.version);
    }
    await transaction(connection, async (tx) => {
      const app = tx(config.database.user);
      await tx`REVOKE ALL ON DATABASE ${tx(config.database.name)} FROM PUBLIC`;
      await tx`REVOKE ALL ON DATABASE ${tx(config.database.name)} FROM ${app}`;
      await tx`REVOKE ALL ON SCHEMA public FROM PUBLIC`;
      await tx`REVOKE ALL ON SCHEMA public FROM ${app}`;
      await tx`REVOKE ALL ON SCHEMA qf FROM PUBLIC`;
      await tx`REVOKE ALL ON SCHEMA qf FROM ${app}`;
      await tx`REVOKE ALL ON SCHEMA qf_meta FROM ${app}`;
      await tx`REVOKE ALL ON ALL TABLES IN SCHEMA qf FROM ${app}`;
      await tx`REVOKE ALL ON ALL TABLES IN SCHEMA qf FROM PUBLIC`;
      await tx`REVOKE ALL ON ALL TABLES IN SCHEMA qf_meta FROM ${app}`;
      // Table-level REVOKE does not remove column grants. Restore the complete column allowlist.
      await tx`REVOKE ALL(id,label,credential_digest,role,status,created_at,disabled_at) ON qf.operator FROM ${app}`;
      await tx`REVOKE ALL(id,token_digest,kind,operator_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at,revoked_at,failed_attempts) ON qf.operator_session FROM ${app}`;
      await tx`REVOKE ALL(id,occurred_at,action,outcome,reason_code,actor_id,session_id,request_id) ON qf.audit_event FROM ${app}`;
      await tx`GRANT CONNECT ON DATABASE ${tx(config.database.name)} TO ${app}`;
      await tx`GRANT USAGE ON SCHEMA qf TO ${app}`;
      await tx`GRANT SELECT ON qf.operator TO ${app}`;
      await tx`GRANT SELECT,INSERT ON qf.operator_session TO ${app}`;
      await tx`GRANT UPDATE(last_seen_at,idle_expires_at,revoked_at,failed_attempts) ON qf.operator_session TO ${app}`;
      await tx`GRANT SELECT,INSERT ON qf.audit_event TO ${app}`;
      // Enums require USAGE, never CREATE; metadata remains inaccessible.
      for (const name of [
        "operator_role",
        "operator_status",
        "session_kind",
        "audit_action",
        "audit_outcome",
        "audit_reason",
      ])
        await tx`GRANT USAGE ON TYPE ${tx(`qf.${name}`)} TO ${app}`;
    });
    return applied;
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    throw new MigrationError("MIGRATION_FAILED");
  } finally {
    try {
      if (locked)
        await connection`SELECT pg_advisory_unlock(716238419221::bigint)`;
    } finally {
      connection.release();
    }
  }
}

async function transaction(
  connection: postgres.ReservedSql,
  callback: (sql: postgres.ReservedSql) => Promise<void>,
) {
  await connection.unsafe("BEGIN");
  try {
    await callback(connection);
    await connection.unsafe("COMMIT");
  } catch (error) {
    await connection.unsafe("ROLLBACK").catch(() => {});
    throw error;
  }
}
