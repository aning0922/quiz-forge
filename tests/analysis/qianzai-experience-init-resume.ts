/** One owned failed-init checkpoint: complete the existing 32-version ACL tail.
 * Not executed without controller review; never alters an applied SQL file. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { openManagedDatabase } from "../../src/lib/db/management";
import { readMigrations, migrateDatabase } from "../../src/lib/db/migrate";
import { CONSUMER_CATALOG_QUERY } from "../../src/lib/db/consumer-catalog";
assert.equal(process.argv.length, 3);
assert.equal(process.argv[2], "--normalize-original-32");
assert.equal(
  process.cwd(),
  "/Users/aipuli/.codex/worktrees/quizforge-qztx-known-ten-experience/quiz-forge",
);
const sha = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
assert.equal(
  sha(await readFile("src/lib/db/migrate.ts")),
  "79a97b96773b39df3674ac4568a2fdf7a6adca9ff4ef43ad4db9abe30ceeeef5",
);
const db = await openManagedDatabase("00486f17f741bd6d6535429e6552d161");
let receipt: object;
try {
  assert.equal(db.manifest.root, process.cwd());
  assert.equal(db.manifest.purpose, "test");
  assert.equal(db.manifest.port, 55538);
  assert.equal(db.manifest.origin, "http://127.0.0.1:63238");
  const definitions = await readMigrations();
  assert.equal(definitions.length, 33);
  assert.equal(definitions[32]!.version, "0033_private_test_known_ten");
  assert.equal(
    sha(definitions[32]!.source),
    "b8fd2bb808b5784145e03025d11a25f29029f752211a975f64df5e9d9bd91290",
  );
  const before =
    await db.sql`SELECT version,checksum FROM qf_meta.schema_migrations ORDER BY version`;
  assert.equal(before.length, 32);
  for (const [i, row] of before.entries()) {
    assert.equal(row.version, definitions[i]!.version);
    assert.equal(row.checksum, sha(definitions[i]!.source));
  }
  const catalog = (await db.sql.unsafe(CONSUMER_CATALOG_QUERY))[0]!;
  assert.equal(
    catalog.sha256,
    "fb7901b1ad57c56c87e03c676d5bc939de35b69e261ca640f7b988a2653f2aa6",
  );
  assert.equal(
    (
      await db.sql`SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()`
    )[0]!.n,
    0,
  );
  const counts = (
    await db.sql`SELECT (SELECT count(*)::int FROM qf.quizpack_import) imports,(SELECT count(*)::int FROM qf.product_asset) product_assets,(SELECT count(*)::int FROM qf.asset_blob) asset_blobs,(SELECT count(*)::int FROM qf.access_key) keys,(SELECT count(*)::int FROM qf.consumer_session) sessions,(SELECT count(*)::int FROM qf.quiz_report) reports`
  )[0]!;
  for (const v of Object.values(counts)) assert.equal(v, 0);
  await writeFile(
    ".cache/known-ten/normalize32.intent.json",
    JSON.stringify({
      instanceId: db.manifest.instanceId,
      root: db.manifest.root,
      beforeCatalog: catalog.sha256,
      operation:
        "existing migrateDatabase with exact already-applied 32 definitions; ACL tail only",
      newSqlMigrations: 0,
    }) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  const applied = await migrateDatabase(
    db.sql,
    db.config,
    definitions.slice(0, 32),
  );
  assert.deepEqual(applied, []);
  const after =
    await db.sql`SELECT version,checksum FROM qf_meta.schema_migrations ORDER BY version`;
  assert.deepEqual([...after], [...before]);
  const actual = (await db.sql.unsafe(CONSUMER_CATALOG_QUERY))[0]!;
  assert.equal(
    actual.sha256,
    "ad236ba8bc23d53c69197a6f603bb17421c8ffce9c4c745de866165ed97fa8d7",
  );
  receipt = {
    status: "PASS_ORIGINAL_32_ACL_TAIL_ONLY",
    instanceId: db.manifest.instanceId,
    applied,
    history: after,
    catalog: actual,
    migration0033: "NOT_RUN_BY_THIS_SCRIPT",
  };
} finally {
  await db.close();
}
await writeFile(
  ".cache/known-ten/normalize32.receipt.json",
  JSON.stringify({ ...receipt, ownerConnectionClosed: true }, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(
  JSON.stringify({
    status: "PASS_ORIGINAL_32_ACL_TAIL_ONLY",
    ownerConnectionClosed: true,
    migration0033: "NOT_RUN",
  }),
);
