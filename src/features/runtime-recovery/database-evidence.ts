import "server-only";
import { createHash } from "node:crypto";
import type postgres from "postgres";
import { readMigrations } from "@/lib/db/migrate";
import {
  RECOVERY_LIMITS,
  RECOVERY_TABLES,
  canonicalRecoveryJson,
  recoveryDatabaseEvidenceSchema,
  recoveryHash,
  type RecoveryDatabaseEvidence,
} from "./contracts";
import type { RecoveryBudget } from "./ports";
import { checkRecoveryBudget } from "./files";
import { RecoveryError } from "./errors";

export type RecoverySql = Pick<postgres.Sql, "unsafe">;
const failure = () => new RecoveryError("RECOVERY_INTEGRITY_FAILED");

export async function readRecoveryDatabaseEvidence(
  sql: RecoverySql,
  budget: RecoveryBudget,
): Promise<RecoveryDatabaseEvidence> {
  checkRecoveryBudget(budget);
  const names = await sql.unsafe<{ name: string }[]>(
    `SELECT n.nspname||'.'||c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname<>'information_schema'
       AND c.relkind IN ('r','p','v','m','f','S') ORDER BY (n.nspname||'.'||c.relname) COLLATE "C"`,
  );
  if (
    JSON.stringify(names.map((row) => row.name)) !==
    JSON.stringify(RECOVERY_TABLES)
  )
    throw failure();
  const history = await sql.unsafe<{ version: string; checksum: string }[]>(
    'SELECT version,checksum FROM qf_meta.schema_migrations ORDER BY version COLLATE "C"',
  );
  const expected = (await readMigrations()).map(({ version, source }) => ({
    version,
    checksum: recoveryHash(source),
  }));
  if (
    expected.length !== 18 ||
    canonicalRecoveryJson(history) !== canonicalRecoveryJson(expected)
  )
    throw failure();
  const tables: RecoveryDatabaseEvidence["tables"] = [];
  let totalBytes = 0;
  for (const name of RECOVERY_TABLES) {
    checkRecoveryBudget(budget);
    const keys = await sql.unsafe<{ name: string; collatable: boolean }[]>(
      `SELECT a.attname name,a.attcollation<>0 collatable FROM pg_index i
       CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ordinal)
       JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
       WHERE i.indrelid=$1::regclass AND i.indisprimary ORDER BY k.ordinal`,
      [name],
    );
    if (!keys.length || keys.some((key) => !/^[a-z][a-z0-9_]*$/.test(key.name)))
      throw failure();
    const order = keys
      .map((key) => `r."${key.name}"${key.collatable ? ' COLLATE "C"' : ""}`)
      .join(",");
    const hash = createHash("sha256");
    let rows = 0,
      bytes = 0;
    for await (const batch of sql
      .unsafe<{ body: string }[]>(
        `SELECT to_jsonb(r)::text body FROM ${name} r ORDER BY ${order}`,
      )
      .cursor(100)) {
      for (const row of batch) {
        checkRecoveryBudget(budget);
        if (typeof row.body !== "string") throw failure();
        const line = Buffer.from(row.body + "\n", "utf8");
        rows++;
        bytes += line.length;
        totalBytes += line.length;
        if (
          rows > RECOVERY_LIMITS.tableRows ||
          totalBytes > RECOVERY_LIMITS.databaseRowBytes
        )
          throw new RecoveryError("RECOVERY_LIMIT_EXCEEDED");
        hash.update(line);
      }
    }
    tables.push({ name, rows, bytes, sha256: hash.digest("hex") });
  }
  const facts = {
    rowFormat: "pg18-jsonb-pk-lf.v1" as const,
    migrations: expected,
    tables,
  };
  return recoveryDatabaseEvidenceSchema.parse({
    ...facts,
    graphSha256: recoveryHash(canonicalRecoveryJson(facts)),
  });
}

export async function setRecoveryRowFormat(sql: RecoverySql): Promise<void> {
  await sql.unsafe("SET LOCAL TimeZone='UTC'");
  await sql.unsafe("SET LOCAL DateStyle='ISO'");
  await sql.unsafe("SET LOCAL IntervalStyle='postgres'");
}
