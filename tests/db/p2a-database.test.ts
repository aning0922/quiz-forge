import { randomUUID } from "node:crypto";
import { lstat, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { acquireAuthWriteLock } from "../../src/lib/db/auth-lock";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  openSql,
  verifyDatabaseIdentity,
} from "../../src/lib/db/client";
import {
  createOperator,
  disableOperator,
  instancePaths,
  loadManagedInstance,
  openManagedDatabase,
} from "../../src/lib/db/management";
import { migrateDatabase, readMigrations } from "../../src/lib/db/migrate";
import { operators } from "../../src/lib/db/schema";
import { digestToken, issueToken } from "../../src/lib/security/p2a-tokens";
import {
  openTestDatabase,
  resetTestDatabase,
  type TestDatabase,
} from "./p2a-fixture";

let database: TestDatabase;
beforeAll(async () => {
  database = await openTestDatabase();
});
beforeEach(async () => {
  await resetTestDatabase(database);
});
afterAll(async () => {
  await database?.close();
});
async function operator(label = "synthetic-one") {
  const id = randomUUID();
  await database.admin
    .sql`INSERT INTO qf.operator(id,label,credential_digest,role,status) VALUES(${id},${label},${issueToken("credential").digest},'operator','active')`;
  return id;
}
async function preauth(sql = database.app.sql) {
  const id = randomUUID(),
    token = issueToken("preauth");
  await sql`INSERT INTO qf.operator_session(id,token_digest,kind,created_at,last_seen_at,idle_expires_at,absolute_expires_at) VALUES(${id},${token.digest},'preauth',now(),now(),now()+interval '5 minutes',now()+interval '5 minutes')`;
  return { id, token };
}
const denied = { code: "42501" };

describe("real P2-A database", () => {
  it("uses PostgreSQL18.4, the correct marker and typed qualified schema", async () => {
    await verifyDatabaseIdentity(database.app.sql, database.config);
    const id = await operator();
    const rows = await database.app.db
      .select({
        id: operators.id,
        label: operators.label,
        role: operators.role,
        status: operators.status,
      })
      .from(operators);
    expect(
      rows.map((r) => ({
        id: r.id,
        label: r.label,
        role: r.role,
        status: r.status,
      })),
    ).toEqual([
      { id, label: "synthetic-one", role: "operator", status: "active" },
    ]);
    const tables = await database.admin
      .sql`SELECT tablename FROM pg_tables WHERE schemaname='qf' ORDER BY tablename`;
    expect(tables.map((r) => r.tablename)).toEqual([
      "access_key",
      "asset_blob",
      "audit_event",
      "category",
      "consumer_exchange_budget",
      "consumer_grant",
      "consumer_session",
      "draft_application",
      "draft_review",
      "draft_revision",
      "internal_play_version",
      "operator",
      "operator_account_operation",
      "operator_kdf_attempt",
      "operator_password_token",
      "operator_session",
      "product",
      "product_asset",
      "product_draft",
      "product_tag",
      "product_version",
      "quiz_report",
      "quizpack_import",
      "quizpack_validation",
      "tag",
    ]);
  });
  it("replays without changing migration evidence and rejects changed checksums", async () => {
    const before = await database.admin
      .sql`SELECT version,checksum,applied_at FROM qf_meta.schema_migrations ORDER BY version`;
    expect(await migrateDatabase(database.admin.sql, database.config)).toEqual(
      [],
    );
    expect(
      await database.admin
        .sql`SELECT version,checksum,applied_at FROM qf_meta.schema_migrations ORDER BY version`,
    ).toEqual(before);
    const definitions = await readMigrations();
    definitions[0] = {
      ...definitions[0]!,
      source: definitions[0]!.source + "\n-- changed",
    };
    await expect(
      migrateDatabase(database.admin.sql, database.config, definitions),
    ).rejects.toMatchObject({ code: "MIGRATION_CHECKSUM_MISMATCH" });
    await expect(
      migrateDatabase(database.admin.sql, database.config, []),
    ).rejects.toMatchObject({ code: "MIGRATION_HISTORY_MISMATCH" });
  });
  it("keeps Drizzle Date fields distinct from raw SQL timestamp strings", async () => {
    const id = await operator();
    const rows = await database.app.db
      .select({ createdAt: operators.createdAt })
      .from(operators);
    const [raw] = await database.app
      .sql`SELECT created_at FROM qf.operator WHERE id=${id}`;
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
    expect(typeof raw?.created_at).toBe("string");
    expect(Date.parse(String(raw?.created_at))).toBe(
      rows[0]?.createdAt.getTime(),
    );
  });
  it("replay removes PUBLIC column grants with the existing table REVOKE", async () => {
    const sql = database.admin.sql;
    const statements = [
      "UPDATE qf.operator SET role='operator' WHERE false",
      "UPDATE qf.operator_session SET absolute_expires_at=now() WHERE false",
      "UPDATE qf.audit_event SET outcome='rejected' WHERE false",
    ];
    try {
      await sql`GRANT UPDATE(role) ON qf.operator TO PUBLIC`;
      await sql`GRANT UPDATE(absolute_expires_at) ON qf.operator_session TO PUBLIC`;
      await sql`GRANT UPDATE(outcome) ON qf.audit_event TO PUBLIC`;
      for (const statement of statements)
        await database.app.sql.unsafe(statement);
      await migrateDatabase(sql, database.config);
      for (const statement of statements)
        await expect(database.app.sql.unsafe(statement)).rejects.toMatchObject(
          denied,
        );
      await preauth();
      await database.app
        .sql`UPDATE qf.operator_session SET last_seen_at=now(),idle_expires_at=absolute_expires_at,revoked_at=now(),failed_attempts=1`;
    } finally {
      await sql`REVOKE UPDATE(role) ON qf.operator FROM PUBLIC`;
      await sql`REVOKE UPDATE(absolute_expires_at) ON qf.operator_session FROM PUBLIC`;
      await sql`REVOKE UPDATE(outcome) ON qf.audit_event FROM PUBLIC`;
    }
  });
  it("rolls back both failed DDL and migration history", async () => {
    const definitions = await readMigrations();
    definitions.push({
      version: "9999_failure_probe",
      source: "CREATE TABLE qf.rollback_probe(id int); SELECT 1/0;",
    });
    await expect(
      migrateDatabase(database.admin.sql, database.config, definitions),
    ).rejects.toMatchObject({ code: "MIGRATION_FAILED" });
    const [result] = await database.admin
      .sql`SELECT to_regclass('qf.rollback_probe') IS NULL AS absent,NOT EXISTS(SELECT 1 FROM qf_meta.schema_migrations WHERE version='9999_failure_probe') AS unrecorded`;
    expect(result).toMatchObject({ absent: true, unrecorded: true });
    expect(await migrateDatabase(database.admin.sql, database.config)).toEqual(
      [],
    );
  });
  it("serializes migration connections with the session advisory lock", async () => {
    const second = await openManagedDatabase(database.config.instanceId);
    const guard = await database.admin.sql.reserve();
    let finished = false;
    try {
      await guard`SELECT pg_advisory_lock(716238419221::bigint)`;
      const pending = migrateDatabase(second.sql, database.config).then(
        (result) => {
          finished = true;
          return result;
        },
      );
      let waiting = false;
      for (let attempt = 0; attempt < 50 && !waiting; attempt++) {
        const [lock] =
          await guard`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND classid=166 AND objid=3273848085) AS waiting`;
        waiting = Boolean(lock?.waiting);
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      // Check actual wait state rather than treating a short timer as proof of serialization.
      const [locks] =
        await guard`SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted`;
      expect(locks?.count).toBeGreaterThan(0);
      expect(finished).toBe(false);
      await guard`SELECT pg_advisory_unlock(716238419221::bigint)`;
      expect(await pending).toEqual([]);
      expect(await migrateDatabase(second.sql, database.config)).toEqual([]);
    } finally {
      await guard`SELECT pg_advisory_unlock_all()`;
      guard.release();
      await second.close();
    }
  });
  it.each([
    "CREATE TABLE qf.forbidden(id int)",
    "CREATE SCHEMA forbidden",
    "CREATE TABLE public.forbidden(id int)",
    "CREATE TEMP TABLE forbidden(id int)",
    "INSERT INTO qf.operator(id,label,credential_digest,role,status) VALUES(gen_random_uuid(),'forbidden',repeat('a',64),'operator','active')",
    "UPDATE qf.operator SET role='operator'",
    "DELETE FROM qf.operator",
    "TRUNCATE qf.operator",
    "UPDATE qf.audit_event SET outcome='rejected'",
    "DELETE FROM qf.audit_event",
    "TRUNCATE qf.audit_event",
    "UPDATE qf.operator_session SET operator_id=NULL",
    "UPDATE qf.operator_session SET kind='authenticated'",
    "UPDATE qf.operator_session SET token_digest=repeat('b',64)",
    "UPDATE qf.operator_session SET created_at=now()",
    "UPDATE qf.operator_session SET absolute_expires_at=now()+interval '1 day'",
    "DELETE FROM qf.operator_session",
    "TRUNCATE qf.operator_session",
    "INSERT INTO qf_meta.schema_migrations VALUES('forbidden',repeat('a',64),now())",
    "SELECT * FROM qf_meta.schema_migrations",
  ])("denies app privilege: %s", async (statement) => {
    await expect(database.app.sql.unsafe(statement)).rejects.toMatchObject(
      denied,
    );
  });
  it("allows only the four session updates and append-only audit", async () => {
    const { id } = await preauth();
    const auditId = randomUUID();
    await database.app
      .sql`UPDATE qf.operator_session SET last_seen_at=now(),idle_expires_at=absolute_expires_at,failed_attempts=1,revoked_at=now() WHERE id=${id}`;
    await database.app
      .sql`INSERT INTO qf.audit_event(id,action,outcome,session_id,request_id) VALUES(${auditId},'login_failed','rejected',${randomUUID()},${randomUUID()})`;
    const [row] = await database.app
      .sql`SELECT failed_attempts,revoked_at IS NOT NULL AS revoked FROM qf.operator_session WHERE id=${id}`;
    expect(row).toMatchObject({ failed_attempts: 1, revoked: true });
    await expect(
      database.app.sql`SELECT id FROM qf.audit_event WHERE id=${auditId}`,
    ).resolves.toHaveLength(1);
  });
  it("refuses namespace CREATE drift before replay; finite grant replay resumes only after explicit owner correction", async () => {
    const sql = database.admin.sql,
      app = sql(database.config.database.user);
    await sql`GRANT CREATE,TEMP ON DATABASE ${sql(database.config.database.name)} TO ${app}`;
    await sql`GRANT CREATE ON SCHEMA qf TO ${app}`;
    await sql`GRANT UPDATE(operator_id,absolute_expires_at) ON qf.operator_session TO ${app}`;
    await expect(migrateDatabase(sql, database.config)).rejects.toThrow(
      "MIGRATION_FAILED",
    );
    const [unrepaired] =
      await sql`SELECT has_schema_privilege(${database.config.database.user},'qf','CREATE') schema_create,has_database_privilege(${database.config.database.user},current_database(),'TEMP') temporary,has_column_privilege(${database.config.database.user},'qf.operator_session','operator_id','UPDATE') column_update`;
    expect(unrepaired).toEqual({
      schema_create: true,
      temporary: true,
      column_update: true,
    });
    // Remove only this test's known namespace grant, never automatic migration repair.
    await sql`REVOKE CREATE ON SCHEMA qf FROM ${app}`;
    await migrateDatabase(sql, database.config);
    for (const statement of [
      "CREATE TABLE qf.forbidden(id int)",
      "CREATE TEMP TABLE forbidden(id int)",
      "UPDATE qf.operator_session SET operator_id=NULL",
      "UPDATE qf.operator_session SET absolute_expires_at=now()+interval '8 hours'",
    ])
      await expect(database.app.sql.unsafe(statement)).rejects.toMatchObject(
        denied,
      );
    await preauth();
    await database.app.sql`UPDATE qf.operator_session SET failed_attempts=1`;
  });
  it.each([
    "INSERT INTO qf.operator(id,label,credential_digest,role,status) VALUES(gen_random_uuid(),'Not Synthetic',repeat('a',64),'operator','active')",
    "INSERT INTO qf.operator(id,label,credential_digest,role,status) VALUES(gen_random_uuid(),'synthetic',repeat('A',64),'operator','active')",
    "INSERT INTO qf.operator(id,label,credential_digest,role,status) VALUES(gen_random_uuid(),'synthetic',repeat('a',64),'operator','disabled')",
    "INSERT INTO qf.operator_session(id,token_digest,kind,created_at,last_seen_at,idle_expires_at,absolute_expires_at) VALUES(gen_random_uuid(),repeat('a',64),'preauth',now(),now(),now()+interval '6 minutes',now()+interval '6 minutes')",
    "INSERT INTO qf.operator_session(id,token_digest,kind,created_at,last_seen_at,idle_expires_at,absolute_expires_at,failed_attempts) VALUES(gen_random_uuid(),repeat('a',64),'preauth',now(),now(),now()+interval '5 minutes',now()+interval '5 minutes',6)",
    "INSERT INTO qf.operator_session(id,token_digest,kind,created_at,last_seen_at,idle_expires_at,absolute_expires_at) VALUES(gen_random_uuid(),repeat('a',64),'authenticated',now(),now(),now()+interval '30 minutes',now()+interval '8 hours')",
  ])("enforces database check constraint: %s", async (statement) => {
    await expect(database.admin.sql.unsafe(statement)).rejects.toMatchObject({
      code: "23514",
    });
  });
  it("rejects authenticated lifetime drift, nonzero attempts, expired last-seen, and reversed revocation", async () => {
    const operatorId = await operator();
    const id = randomUUID();
    await database.admin
      .sql`INSERT INTO qf.operator_session(id,token_digest,kind,operator_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at) VALUES(${id},${issueToken("session").digest},'authenticated',${operatorId},now(),now(),now()+interval '30 minutes',now()+interval '8 hours')`;
    for (const statement of [
      "absolute_expires_at=created_at+interval '9 hours'",
      "idle_expires_at=last_seen_at+interval '31 minutes'",
      "failed_attempts=1",
      "last_seen_at=absolute_expires_at",
      "revoked_at=created_at-interval '1 second'",
    ])
      await expect(
        database.admin.sql.unsafe(
          `UPDATE qf.operator_session SET ${statement}`,
        ),
      ).rejects.toMatchObject({ code: "23514" });
    await expect(
      database.admin.sql`DELETE FROM qf.operator WHERE id=${operatorId}`,
    ).rejects.toMatchObject({ code: "23001" });
  });
  it("fails closed for wrong marker, role, version and endpoint server facts", async () => {
    for (const config of [
      {
        ...database.config,
        server: { ...database.config.server, version: 180003 },
      },
      {
        ...database.config,
        server: { ...database.config.server, port: 55499 },
      },
      {
        ...database.config,
        database: {
          ...database.config.database,
          user: `qf_owner_${database.config.instanceId}`,
        },
      },
    ])
      await expect(
        createDatabase(config as typeof database.config),
      ).rejects.toThrow("STUDIO_UNAVAILABLE");
    await database.admin.sql.unsafe(
      `COMMENT ON DATABASE "${database.config.database.name}" IS 'wrong-marker'`,
    );
    try {
      await expect(createDatabase(database.config)).rejects.toThrow(
        "STUDIO_UNAVAILABLE",
      );
    } finally {
      await database.admin.sql.unsafe(
        `COMMENT ON DATABASE "${database.config.database.name}" IS 'quizforge.p2a.v1:${database.config.instanceId}:${database.config.purpose}'`,
      );
    }
  });
  it("bootstraps only generated secrets into new private files and compensates known DB failure", async () => {
    const paths = instancePaths(database.config.instanceId);
    const file = path.join(
      paths.directory,
      `operator-${randomUUID()}.credential`,
    );
    const duplicate = path.join(
      paths.directory,
      `operator-${randomUUID()}.credential`,
    );
    try {
      const result = await createOperator(database.config.instanceId, {
        label: "synthetic-bootstrap",
        role: "read-only",
        credentialFile: file,
      });
      expect((await lstat(file)).mode & 0o777).toBe(0o600);
      const credential = (await readFile(file, "utf8")).trim();
      const [row] = await database.admin
        .sql`SELECT credential_digest,role FROM qf.operator WHERE id=${result.id}`;
      // A boolean assertion prevents printing a secret in failure diffs.
      expect(
        row?.credential_digest === digestToken(credential, "credential"),
      ).toBe(true);
      expect(row?.role).toBe("read-only");
      await expect(
        createOperator(database.config.instanceId, {
          label: "synthetic-bootstrap",
          role: "operator",
          credentialFile: duplicate,
        }),
      ).rejects.toMatchObject({ code: "BOOTSTRAP_FAILED" });
      await expect(lstat(duplicate)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        createOperator(database.config.instanceId, {
          label: "another",
          role: "operator",
          credentialFile: file,
        }),
      ).rejects.toMatchObject({ code: "BOOTSTRAP_FAILED" });
      expect((await readFile(file, "utf8")) === credential + "\n").toBe(true);
      const audit = await database.admin
        .sql`SELECT action FROM qf.audit_event WHERE actor_id=${result.id}`;
      expect(audit.map((r) => r.action)).toEqual(["bootstrap"]);
    } finally {
      await unlink(file).catch(() => {});
      await unlink(duplicate).catch(() => {});
    }
  });
  it("disables without deleting operator and revokes sessions with an idempotent audit", async () => {
    const operatorId = await operator(),
      sessionId = randomUUID();
    await database.app
      .sql`INSERT INTO qf.operator_session(id,token_digest,kind,operator_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at) VALUES(${sessionId},${issueToken("session").digest},'authenticated',${operatorId},now(),now(),now()+interval '30 minutes',now()+interval '8 hours')`;
    expect(
      await disableOperator(database.config.instanceId, operatorId),
    ).toEqual({ id: operatorId, changed: true });
    expect(
      await disableOperator(database.config.instanceId, operatorId),
    ).toEqual({ id: operatorId, changed: false });
    const [row] = await database.app
      .sql`SELECT status,disabled_at IS NOT NULL AS disabled FROM qf.operator WHERE id=${operatorId}`;
    expect(row).toMatchObject({ status: "disabled", disabled: true });
    const [session] = await database.app
      .sql`SELECT revoked_at IS NOT NULL AS revoked FROM qf.operator_session WHERE id=${sessionId}`;
    expect(session?.revoked).toBe(true);
    const receipts = await database.admin.sql<{ operation_id: string }[]>`
      SELECT operation_id FROM qf.operator_account_operation
      WHERE action='disable' AND actor_id IS NULL AND target_id=${operatorId} AND status='completed'`;
    expect(receipts).toHaveLength(1);
    // This confirmed receipt belongs to this test's unique target. Never broaden reset authority.
    await database.admin.sql`DELETE FROM qf.operator_account_operation
      WHERE operation_id=${receipts[0]!.operation_id} AND target_id=${operatorId} AND actor_id IS NULL`;
  });
  it("management disable waits for auth writes then revokes the newly committed session", async () => {
    const operatorId = await operator(),
      sessionId = randomUUID();
    const second = await createDatabase(database.config);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = () => {};
    const enteredGate = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const login = second.sql.begin(async (tx) => {
      await acquireAuthWriteLock(tx);
      const [active] =
        await tx`SELECT status FROM qf.operator WHERE id=${operatorId}`;
      if (active?.status !== "active")
        throw new Error("TEST_ACTIVE_OPERATOR_REQUIRED");
      entered();
      await gate;
      // Create after disable has begun waiting. Transaction-start now() would make its revocation invalid.
      await tx`WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS at)
        INSERT INTO qf.operator_session(id,token_digest,kind,operator_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at)
        SELECT ${sessionId},${issueToken("session").digest},'authenticated',${operatorId},at,at,at+interval '30 minutes',at+interval '8 hours' FROM moment`;
    });
    void login.catch(() => entered());
    let disabling: ReturnType<typeof disableOperator> | undefined;
    try {
      await enteredGate;
      disabling = disableOperator(database.config.instanceId, operatorId);
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const [lock] = await database.admin
          .sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=72461 AND objid=1 AND NOT granted) AS waiting`;
        waiting = Boolean(lock?.waiting);
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      release();
      await login;
      expect(await disabling).toEqual({ id: operatorId, changed: true });
      const rows = await database.admin.sql<
        {
          operation_id: string;
          revoked: boolean;
          valid_time: boolean;
          valid_disable_time: boolean;
          valid_receipt_time: boolean;
        }[]
      >`
        SELECT a.operation_id,s.revoked_at IS NOT NULL AS revoked,s.revoked_at>=s.created_at AS valid_time,
          o.disabled_at>=s.created_at AND s.revoked_at>=o.disabled_at AS valid_disable_time,
          a.created_at>=s.revoked_at AS valid_receipt_time
          FROM qf.operator_session s JOIN qf.operator o ON o.id=s.operator_id
          JOIN qf.operator_account_operation a ON a.target_id=o.id AND a.actor_id IS NULL AND a.action='disable' AND a.status='completed'
          WHERE s.id=${sessionId}`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        revoked: true,
        valid_time: true,
        valid_disable_time: true,
        valid_receipt_time: true,
      });
      await database.admin.sql`DELETE FROM qf.operator_account_operation
        WHERE operation_id=${rows[0]!.operation_id} AND target_id=${operatorId} AND actor_id IS NULL`;
    } finally {
      release();
      await login.catch(() => {});
      await disabling?.catch(() => {});
      await second.close();
    }
  });
  it("auth writes reread disabled identity after a competing management lock", async () => {
    const operatorId = await operator();
    const second = await createDatabase(database.config);
    let release = () => {},
      entered = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const enteredGate = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const management = database.admin.sql.begin(async (tx) => {
      await acquireAuthWriteLock(tx);
      await tx`UPDATE qf.operator SET status='disabled',disabled_at=now() WHERE id=${operatorId}`;
      entered();
      await gate;
    });
    void management.catch(() => entered());
    let login: Promise<boolean> | undefined;
    try {
      await enteredGate;
      login = second.sql.begin(async (tx) => {
        await acquireAuthWriteLock(tx);
        const [active] =
          await tx`SELECT status FROM qf.operator WHERE id=${operatorId}`;
        return active?.status === "active";
      });
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const [lock] = await database.admin
          .sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=72461 AND objid=1 AND NOT granted) AS waiting`;
        waiting = Boolean(lock?.waiting);
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      release();
      await management;
      expect(await login).toBe(false);
    } finally {
      release();
      await management.catch(() => {});
      await login?.catch(() => {});
      await second.close();
    }
  });
  it("never makes app a database/schema/table owner or a member of privileged roles", async () => {
    const [privileges] = await database.app
      .sql`SELECT rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,rolinherit FROM pg_roles WHERE rolname=current_user`;
    expect(privileges).toMatchObject({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolbypassrls: false,
      rolinherit: false,
    });
    const [owned] = await database.admin
      .sql`SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=(SELECT oid FROM pg_roles WHERE rolname=${database.config.database.user})) AS schemas,EXISTS(SELECT 1 FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=${database.config.database.user})) AS tables`;
    expect(owned).toMatchObject({ schemas: false, tables: false });
    const managed = await loadManagedInstance(database.config.instanceId);
    const sql = openSql(managed.admin.owner);
    try {
      await verifyDatabaseIdentity(
        sql,
        database.config,
        managed.admin.owner.user,
      );
    } finally {
      await sql.end();
    }
  });
});
