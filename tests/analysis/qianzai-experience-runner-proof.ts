/** Four bounded real-PG observations in the original failed fresh instance.
 * Faulting the exact driver's method is the existing test-only injection pattern. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { openManagedDatabase } from "../../src/lib/db/management";
import { migrateDatabase, readMigrations } from "../../src/lib/db/migrate";
import { CONSUMER_CATALOG_QUERY } from "../../src/lib/db/consumer-catalog";
const [phase] = process.argv.slice(2);
assert((phase === "rejects" || phase === "after") && process.argv.length === 3);
assert.equal(
  process.cwd(),
  "/Users/aipuli/.codex/worktrees/quizforge-qztx-known-ten-experience/quiz-forge",
);
const id = "00486f17f741bd6d6535429e6552d161",
  prefix = ".cache/known-ten/runner-real-";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const save = async (name: string, value: unknown) =>
  writeFile(prefix + name + ".json", JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
const db = await openManagedDatabase(id);
const completed: string[] = [];
try {
  assert.equal(db.manifest.root, process.cwd());
  assert.equal(db.manifest.purpose, "test");
  assert.equal(db.manifest.port, 55538);
  const definitions = await readMigrations();
  assert.equal(definitions.length, 33);
  const source = definitions[32]!.source;
  assert.equal(
    sha(source),
    "b8fd2bb808b5784145e03025d11a25f29029f752211a975f64df5e9d9bd91290",
  );
  const snapshot = async () => ({
    catalog: (await db.sql.unsafe(CONSUMER_CATALOG_QUERY))[0]!,
    ledger: [
      ...(await db.sql`SELECT version,checksum,applied_at FROM qf_meta.schema_migrations ORDER BY version`),
    ],
    functions: [
      ...(await db.sql`SELECT p.oid::regprocedure::text signature,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') body_sha256,to_jsonb(p)-'prosrc'-'prosqlbody'-'proacl' metadata FROM pg_proc p WHERE p.pronamespace='qf'::regnamespace ORDER BY 1`),
    ],
  });
  if (phase === "rejects") {
    const before = await snapshot();
    assert.equal(
      before.catalog.sha256,
      "fb7901b1ad57c56c87e03c676d5bc939de35b69e261ca640f7b988a2653f2aa6",
    );
    assert.equal(before.ledger.length, 32);
    await save("before", before);
    for (const kind of ["maintenance-shared", "external-connection"] as const) {
      const other = await openManagedDatabase(id);
      let pid;
      try {
        pid = (await other.sql`SELECT pg_backend_pid() pid`)[0]!.pid;
        if (kind === "maintenance-shared")
          await other.sql`SELECT pg_advisory_lock_shared(72461,2)`;
        await assert.rejects(migrateDatabase(db.sql, db.config), {
          code: "MIGRATION_FAILED",
        });
      } finally {
        if (kind === "maintenance-shared")
          await other.sql`SELECT pg_advisory_unlock_shared(72461,2)`;
        await other.close();
      }
      assert.deepEqual(await snapshot(), before);
      completed.push(kind);
      await save(kind, {
        status: "PASS_REJECTED_RAW32_UNCHANGED",
        ownedOtherBackend: pid,
        otherConnectionClosed: true,
        ledgerIncludingAppliedAtUnchanged: true,
        catalogSha256: before.catalog.sha256,
      });
    }
    const nativeReserve = db.sql.reserve;
    let restore: (() => void) | undefined;
    const observation = {
      executed033: false,
      catalogInside: "",
      ledger033Absent: false,
      rollbackAcknowledged: false,
    };
    db.sql.reserve = (async () => {
      const tx = await nativeReserve.call(db.sql),
        nativeUnsafe = tx.unsafe;
      restore = () => {
        tx.unsafe = nativeUnsafe;
      };
      tx.unsafe = (async (...args: Parameters<typeof nativeUnsafe>) => {
        const result = await Reflect.apply(nativeUnsafe, tx, args);
        if (args[0] === "ROLLBACK") observation.rollbackAcknowledged = true;
        if (args[0] === source) {
          observation.executed033 = true;
          observation.catalogInside = (
            await Reflect.apply(nativeUnsafe, tx, [CONSUMER_CATALOG_QUERY])
          )[0]!.sha256;
          observation.ledger033Absent = (
            await tx`SELECT NOT EXISTS(SELECT 1 FROM qf_meta.schema_migrations WHERE version='0033_private_test_known_ten') absent`
          )[0]!.absent;
          assert.equal(
            observation.catalogInside,
            "57137878c47b73d1914ace7f9198812d932727ef40d05b95d8514712762c9143",
          );
          assert.equal(observation.ledger033Absent, true);
          throw Error("RUNNER_INJECTED_AFTER_0033_BEFORE_LEDGER");
        }
        return result;
      }) as typeof nativeUnsafe;
      return tx;
    }) as typeof nativeReserve;
    try {
      await assert.rejects(migrateDatabase(db.sql, db.config), {
        code: "MIGRATION_FAILED",
      });
    } finally {
      restore?.();
      db.sql.reserve = nativeReserve;
    }
    assert.equal(observation.executed033, true);
    assert.equal(observation.rollbackAcknowledged, true);
    assert.deepEqual(await snapshot(), before);
    completed.push("after033-rollback");
    await save("after033-rollback", {
      status: "PASS_CHECKPOINT_PLUS_0033_ROLLBACK",
      observation,
      raw32CatalogRestored: true,
      allFunctionMetadataAndBodiesRestored: true,
      ledgerIncludingAppliedAtUnchanged: true,
    });
    await save("rejects", {
      status: "PASS_THREE_PRE_SUCCESS_CASES",
      completed,
      ownerConnectionWillClose: true,
    });
  } else {
    const before = JSON.parse(await readFile(prefix + "before.json", "utf8")),
      after = await snapshot();
    assert.equal(
      after.catalog.sha256,
      "57137878c47b73d1914ace7f9198812d932727ef40d05b95d8514712762c9143",
    );
    assert.equal(after.ledger.length, 33);
    assert.deepEqual(
      JSON.parse(JSON.stringify(after.ledger.slice(0, 32))),
      before.ledger,
    );
    for (const [i, row] of after.ledger.entries()) {
      assert.equal(row.version, definitions[i]!.version);
      assert.equal(row.checksum, sha(definitions[i]!.source));
    }
    const changed = [];
    assert.equal(after.functions.length, before.functions.length);
    const allowed = new Set([
      "consumer_schema_v2",
      "private_test_database_valid",
      "private_test_structure_valid",
      "private_test_source_valid",
      "product_asset_declaration_valid",
      "internal_review_valid",
    ]);
    for (const f of after.functions) {
      const old = before.functions.find(
        (v: { signature: string }) => v.signature === f.signature,
      );
      assert(old);
      assert.deepEqual(f.metadata, old.metadata);
      if (f.body_sha256 !== old.body_sha256) {
        assert(
          allowed.has(String(f.signature).split("(")[0]!.split(".").at(-1)!),
        );
        changed.push(f.signature);
      }
    }
    assert.equal(changed.length, 6);
    completed.push("normal-cli-migrate-only033");
    await save("after", {
      status: "PASS_NORMAL_0033_LEDGER_AND_AUTHORITY",
      ...after,
      changed,
      prior32IncludingAppliedAtUnchanged: true,
      allFunctionOwnerMetadataUnchanged: true,
      aclCatalogMatchesReviewedBaseline: true,
    });
  }
  const counts = (
    await db.sql`SELECT (SELECT count(*)::int FROM qf.quizpack_import) imports,(SELECT count(*)::int FROM qf.asset_blob) blobs,(SELECT count(*)::int FROM qf.product_asset) assets,(SELECT count(*)::int FROM qf.access_key) keys,(SELECT count(*)::int FROM qf.consumer_session) sessions,(SELECT count(*)::int FROM qf.quiz_report) reports,(SELECT count(*)::int FROM qf.consumer_product_head) heads,(SELECT count(*)::int FROM qf.consumer_product_activation) activations`
  )[0]!;
  for (const v of Object.values(counts)) assert.equal(v, 0);
  assert.equal(
    (
      await db.sql`SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()`
    )[0]!.n,
    0,
  );
  await save(phase + "-close-intent", {
    completed,
    counts,
    otherConnections: 0,
  });
} catch (error) {
  await save(phase + "-" + randomUUID() + "-failure", {
    completed,
    error: error instanceof Error ? error.message : String(error),
  });
  throw error;
} finally {
  await db.close();
}
await save(phase + "-close", { status: "OWNER_CLOSE_CONFIRMED", completed });
console.log(JSON.stringify({ phase, completed, ownerConnectionClosed: true }));
