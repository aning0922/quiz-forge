import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { openManagedDatabase } from "@/lib/db/management";
import { readMigrations } from "@/lib/db/migrate";
import { CONSUMER_CATALOG_QUERY } from "@/lib/db/consumer-catalog";

let owner: Awaited<ReturnType<typeof openManagedDatabase>>,
  source: string,
  before: string;
async function catalog() {
  const [row] = await owner.sql.unsafe<{ sha256: string }[]>(
    CONSUMER_CATALOG_QUERY,
  );
  return row!.sha256;
}
beforeAll(async () => {
  const config = await loadRuntimeConfig();
  if (
    (config.purpose !== "test" && config.purpose !== "ci") ||
    process.env.QUIZFORGE_ACCOUNTS_MIGRATION_STAGE !== "0022"
  )
    throw Error("EXPLICIT_PRISTINE_0022_TEST_REQUIRED");
  owner = await openManagedDatabase(config.instanceId);
  const [scope] =
    await owner.sql`SELECT (SELECT max(version) FROM qf_meta.schema_migrations) version,(SELECT count(*)::int FROM qf.operator) accounts`;
  if (scope?.version !== "0022_account_directory_read" || scope.accounts !== 0)
    throw Error("PRISTINE_0022_REQUIRED");
  const migration = (await readMigrations()).at(-1);
  if (migration?.version !== "0023_current_password_accounts")
    throw Error("EXPECTED_CURRENT_MIGRATION_REQUIRED");
  source = migration.source;
  before = await catalog();
});
afterAll(async () => {
  await owner?.close();
});

it.each([
  "missing-names",
  "noncanonical-display",
  "null-role",
  "null-revision",
  "invalid-revision",
  "legacy-credential",
])(
  "rejects %s without modifying identities or leaving partial DDL",
  async (kind) => {
    const id = randomUUID();
    await expect(
      owner.sql.begin(async (tx) => {
        if (kind === "null-role")
          await tx`ALTER TABLE qf.operator ALTER COLUMN role DROP NOT NULL`;
        if (kind === "null-revision")
          await tx`ALTER TABLE qf.operator ALTER COLUMN account_revision DROP NOT NULL`;
        if (kind === "invalid-revision")
          await tx`ALTER TABLE qf.operator DROP CONSTRAINT operator_account_revision`;
        await tx`INSERT INTO qf.operator(id,label,credential_digest,login_name,display_name,role,status,account_revision)
        VALUES(${id},${"synthetic-" + id},${kind === "legacy-credential" ? "a".repeat(64) : null},
          ${kind === "missing-names" ? null : "synthetic-" + id},${kind === "missing-names" ? null : kind === "noncanonical-display" ? "合成名称\u00a0" : "合成身份"},
          ${kind === "null-role" ? null : "operator"},'active',${kind === "null-revision" ? null : kind === "invalid-revision" ? 0 : 1})`;
        await tx.unsafe(source);
      }),
    ).rejects.toThrow("ACCOUNT_IDENTITY_INVALID");
    expect(await catalog()).toBe(before);
    const [row] =
      await owner.sql`SELECT count(*)::int n FROM qf.operator WHERE id=${id}`;
    expect(row!.n).toBe(0); // the synthetic setup and rejected migration shared one confirmed rollback.
  },
);
it("preserves complete pending identities and audit UUIDs, then fully rolls back a later DDL failure", async () => {
  const id = randomUUID(),
    audit = randomUUID();
  const sentinel = Error("SYNTHETIC_CONFIRMED_ROLLBACK");
  await expect(
    owner.sql.begin(async (tx) => {
      await tx`INSERT INTO qf.operator(id,label,login_name,display_name,role,status) VALUES(${id},${"synthetic-" + id},${"synthetic-" + id},'合成待设密','operator','active')`;
      await tx`INSERT INTO qf.audit_event(id,action,outcome,actor_id,request_id) VALUES(${audit},'bootstrap','success',${id},${audit})`;
      await tx.unsafe(source);
      const [row] =
        await tx`SELECT o.id,o.login_name,o.display_name,o.account_revision,o.password_hash IS NULL pending,a.actor_id
      FROM qf.operator o JOIN qf.audit_event a ON a.actor_id=o.id WHERE o.id=${id} AND a.id=${audit}`;
      expect(row).toMatchObject({
        id,
        login_name: "synthetic-" + id,
        display_name: "合成待设密",
        account_revision: 1,
        pending: true,
        actor_id: id,
      });
      const [columns] =
        await tx`SELECT count(*)::int n FROM pg_attribute WHERE attrelid='qf.operator'::regclass AND NOT attisdropped AND attname IN('label','credential_digest')`;
      expect(columns!.n).toBe(0);
      throw sentinel;
    }),
  ).rejects.toBe(sentinel);
  expect(await catalog()).toBe(before);
});
