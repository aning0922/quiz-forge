import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { loadRuntimeConfig } from "../src/lib/db/runtime";
import { openManagedDatabase } from "../src/lib/db/management";
import { CONSUMER_CATALOG_QUERY } from "../src/lib/db/consumer-catalog";

/** Read-only candidate generation AFTER the coordinator's isolated migration. No implicit repair. */
const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== "--instance" || args[2] !== "--out")
  throw Error("EXPLICIT_CATALOG_TARGET_REQUIRED");
const config = await loadRuntimeConfig();
if (config.instanceId !== args[1] || !["test", "ci"].includes(config.purpose))
  throw Error("TEST_CATALOG_IDENTITY_REQUIRED");
const out = resolve(args[3]!);
if (!out.startsWith(resolve(process.cwd(), ".cache") + "/"))
  throw Error("PRIVATE_CANDIDATE_OUTPUT_REQUIRED");
const owner = await openManagedDatabase(config.instanceId);
try {
  const [migration] =
    await owner.sql`SELECT version FROM qf_meta.schema_migrations WHERE version='0025_preference_scene_slot'`;
  if (!migration) throw Error("D3_MIGRATION_REQUIRED");
  const [catalog] = await owner.sql.unsafe<{ sha256: string }[]>(
    CONSUMER_CATALOG_QUERY,
  );
  const [tables] = await owner.sql<
    { count: number }[]
  >`SELECT count(*)::integer count FROM pg_class WHERE relnamespace='qf'::regnamespace AND relkind='r'`;
  if (
    !catalog ||
    !/^[a-f0-9]{64}$/.test(catalog.sha256) ||
    tables?.count !== 25
  )
    throw Error("D3_CATALOG_INVALID");
  await writeFile(
    out,
    `import "server-only";\n/** Exact isolated PG18.4 catalog after 0025_preference_scene_slot. */\nexport const consumerSchemaFacts = ${JSON.stringify({ sha256: catalog.sha256, tables: tables.count }, null, 2)} as const;\n`,
    { flag: "wx", mode: 0o600 },
  );
} finally {
  await owner.close();
}
