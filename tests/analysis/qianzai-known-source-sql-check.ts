/** Exact owned b3 SQL admission checks, not native media or consumer evidence. */
import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { openManagedDatabase } from "../../src/lib/db/management";
import { CONSUMER_CATALOG_QUERY } from "../../src/lib/db/consumer-catalog";
import { canonicalP1Json as canonical } from "../../src/features/quizpack/v1/canonical";
import { quizPackContentV3Schema } from "../../src/features/quizpack/content/v3";
import registration from "../../src/features/quizpack/content/private-test-registration-known-ten-final.json";
import baseline from "../../src/features/product/internal-versions/baselines/qztx-known-ten-private-20261104.json";

const [phase] = process.argv.slice(2);
assert((phase === "before" || phase === "after") && process.argv.length === 3);
const out = path.join(
  process.cwd(),
  ".cache/known-ten/source-0033-" + phase + ".receipt.json",
);
const sha = (text: string | Uint8Array) =>
  createHash("sha256").update(text).digest("hex");
const db = await openManagedDatabase(registration.instanceId);
const checks: string[] = [];
let result: object;
try {
  assert.equal(db.manifest.root, process.cwd());
  assert.equal(db.manifest.purpose, "test");
  assert.equal(db.manifest.port, 55537);
  assert.equal(db.manifest.origin, registration.origin);
  const migrations =
    await db.sql`SELECT version,checksum FROM qf_meta.schema_migrations ORDER BY version`;
  assert.equal(migrations.length, phase === "before" ? 32 : 33);
  const files = (await readdir("migrations/p2a"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const [i, row] of migrations.entries()) {
    assert.equal(files[i], row.version + ".sql");
    assert.equal(
      sha(await readFile(path.join("migrations/p2a", files[i]!))),
      row.checksum,
    );
  }
  const functions =
    await db.sql`SELECT p.oid::regprocedure::text signature,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') body_sha256,to_jsonb(p)-'prosrc'-'prosqlbody' metadata FROM pg_proc p WHERE p.pronamespace='qf'::regnamespace ORDER BY 1`;
  const catalog = (await db.sql.unsafe(CONSUMER_CATALOG_QUERY))[0]!;
  const count = async () =>
    (
      await db.sql`SELECT (SELECT count(*)::int FROM qf.quizpack_import) imports,(SELECT count(*)::int FROM qf.product_asset) product_assets,(SELECT count(*)::int FROM qf.asset_blob) asset_blobs,(SELECT count(*)::int FROM qf.access_key) keys,(SELECT count(*)::int FROM qf.consumer_session) sessions,(SELECT count(*)::int FROM qf.quiz_report) reports,(SELECT count(*)::int FROM qf.consumer_product_head) heads,(SELECT count(*)::int FROM qf.consumer_product_activation) activations`
    )[0]!;
  for (const value of Object.values(await count())) assert.equal(value, 0);
  checks.push("migration_checksums_and_empty_owned_database");
  if (phase === "before") {
    assert.equal(
      catalog.sha256,
      "ad236ba8bc23d53c69197a6f603bb17421c8ffce9c4c745de866165ed97fa8d7",
    );
    result = {
      status: "PASS_0033_PRESTATE_CAPTURE",
      functions,
      catalog,
      migrations,
    };
  } else {
    const before = JSON.parse(
      await readFile(
        path.join(
          process.cwd(),
          ".cache/known-ten/source-0033-before.receipt.json",
        ),
        "utf8",
      ),
    );
    assert.equal(before.status, "PASS_0033_PRESTATE_CAPTURE");
    assert.equal(functions.length, before.functions.length);
    const allowed = new Set([
      "consumer_schema_v2",
      "private_test_database_valid",
      "private_test_structure_valid",
      "private_test_source_valid",
      "product_asset_declaration_valid",
      "internal_review_valid",
    ]);
    const changed = [];
    for (const current of functions) {
      const prior = before.functions.find(
        (f: { signature: string }) => f.signature === current.signature,
      );
      assert(prior);
      assert.deepEqual(current.metadata, prior.metadata);
      if (current.body_sha256 !== prior.body_sha256) {
        assert(
          allowed.has(
            String(current.signature).split("(")[0]!.split(".").at(-1)!,
          ),
        );
        changed.push(current.signature);
      }
    }
    assert.equal(changed.length, 6);
    checks.push(
      "only_six_reviewed_bodies_changed_all_function_metadata_and_acl_preserved",
    );
    const content = quizPackContentV3Schema.parse(
      JSON.parse(
        await readFile(
          path.join(
            process.cwd(),
            ".cache/known-ten/content-candidate-v1/content.json",
          ),
          "utf8",
        ),
      ),
    );
    assert.equal(sha(canonical(content)), registration.canonicalContentSha256);
    const sourceValid = async (
      value: unknown,
      asset = registration.assetSetSha256,
      manifest = registration.canonicalManifestSha256,
    ) =>
      (
        await db.sql`SELECT qf.private_test_source_valid(${canonical(value)}::text::jsonb,${asset},${manifest}) valid`
      )[0]!.valid;
    assert.equal(
      (await db.sql`SELECT qf.private_test_database_valid() valid`)[0]!.valid,
      true,
    );
    assert.equal(
      (
        await db.sql`SELECT qf.consumer_json_valid_v2(${canonical(content)}::text::jsonb,qf.consumer_schema_v2('content'),0) valid`
      )[0]!.valid,
      true,
    );
    assert.equal(await sourceValid(content), true);
    checks.push(
      "exact_b3_source_schema_database_marker_and_three_hashes_accept",
    );
    for (const field of [
      "asset",
      "manifest",
      "source",
      "instance",
      "authorization",
      "foreign-product",
    ] as const) {
      const altered = structuredClone(content);
      if (field === "source") altered.core.title += "篡改";
      if (field === "instance")
        altered.bindings.privateTestUse!.instanceId =
          "1ec2da760d5ccc0aa38664bcc4aefca6";
      if (field === "authorization")
        Reflect.set(
          altered.bindings.privateTestUse!,
          "authorizationId",
          "other-private-test",
        );
      if (field === "foreign-product")
        altered.core.scoringDefinition.productId = "other-product";
      assert.equal(
        await sourceValid(
          altered,
          field === "asset" ? "f".repeat(64) : registration.assetSetSha256,
          field === "manifest"
            ? "f".repeat(64)
            : registration.canonicalManifestSha256,
        ),
        false,
      );
    }
    checks.push(
      "source_asset_manifest_instance_authorization_foreign_product_rejected",
    );
    const row = (
      change: "none" | "baseline" | "approval" | "target" = "none",
    ) => {
      const uuid = "00000000-0000-4000-8000-000000000001";
      const target = {
        draftId: uuid,
        revision: 1,
        canonicalContentSha256: registration.canonicalContentSha256,
        assetSetSha256: registration.assetSetSha256,
        canonicalManifestSha256: registration.canonicalManifestSha256,
      };
      const identity = {
        kind: "baseline",
        id: baseline.id,
        version: baseline.version,
        entrySha256: sha(canonical(baseline)),
      };
      const approval = structuredClone(baseline.approval);
      if (change === "baseline") identity.entrySha256 = "f".repeat(64);
      if (change === "approval")
        approval.instanceId = "1ec2da760d5ccc0aa38664bcc4aefca6";
      if (change === "target") target.assetSetSha256 = "f".repeat(64);
      const binding = {
        schemaVersion: "quizforge.review-record.v1",
        productId: registration.productId,
        idempotencyKey: uuid,
        target,
        baseline: identity,
      };
      const facts = {
        schemaVersion: "quizforge.internal-review-facts.v1",
        productId: registration.productId,
        target,
        baseline: identity,
        purpose: "internal-test",
        approval,
      };
      return {
        product_id: registration.productId,
        draft_id: uuid,
        revision: 1,
        canonical_content_sha256: target.canonicalContentSha256,
        asset_set_sha256: target.assetSetSha256,
        canonical_manifest_sha256: target.canonicalManifestSha256,
        purpose: "internal-test",
        idempotency_key: uuid,
        binding_text: canonical(binding),
        fingerprint: sha(canonical(binding)),
        facts_text: canonical(facts),
        review_sha256: sha(canonical(facts)),
      };
    };
    for (const change of ["none", "baseline", "approval", "target"] as const)
      assert.equal(
        (
          await db.sql`SELECT qf.internal_review_valid(jsonb_populate_record(NULL::qf.draft_review,${canonical(row(change))}::text::jsonb)) valid`
        )[0]!.valid,
        change === "none",
      );
    checks.push(
      "exact_baseline_accepts_and_baseline_approval_target_mix_rejects",
    );
    // Rollback-only metadata fixture. This is not an admitted/decoded/stored blob.
    const rollback = new Error("EXPECTED_METADATA_FIXTURE_ROLLBACK");
    const declaration = content.bindings.resources.find(
      (r) => r.version === "3.0.0",
    )!;
    try {
      await db.sql.begin(async (sql) => {
        await sql`INSERT INTO qf.asset_blob(sha256,bytes,media_type,width,height,frames,storage_key,created_at) VALUES(${declaration.sha256},${declaration.bytes},${declaration.mediaType},${declaration.width},${declaration.height},1,${"blobs/" + declaration.sha256 + ".blob"},clock_timestamp())`;
        for (const change of [
          "none",
          "declaration",
          "ref",
          "license",
        ] as const) {
          const altered = structuredClone(declaration);
          if (change === "declaration") altered.source.evidence += "篡改";
          if (change === "ref") altered.id += "-other";
          if (change === "license") altered.license.redistribution = true;
          assert.equal(
            (
              await sql`SELECT qf.product_asset_declaration_valid(${altered.productId},${altered.id},${altered.version},${altered.sha256},${altered.purpose},${canonical(altered)}) valid`
            )[0]!.valid,
            change === "none",
          );
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    for (const value of Object.values(await count())) assert.equal(value, 0);
    checks.push(
      "new_declaration_accepts_and_declaration_ref_license_reject_rollback_confirmed",
    );
    result = {
      status: "PASS_0033_TARGETED_SQL_ONLY",
      functions,
      changed,
      catalog,
      migrations,
      counts: await count(),
      nativeMedia: "NOT_RUN",
      sourceImported: false,
    };
  }
  const connections = (
    await db.sql`SELECT count(*)::int count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()`
  )[0]!.count;
  assert.equal(connections, 0);
  result = {
    ...result,
    instanceId: registration.instanceId,
    root: db.manifest.root,
    checks,
    otherConnections: connections,
  };
} catch (error) {
  await writeFile(
    out + "." + randomUUID() + ".failure.json",
    JSON.stringify(
      {
        phase,
        checks,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  throw error;
} finally {
  await db.close();
}
await writeFile(
  out,
  JSON.stringify({ ...result, ownerConnectionClosed: true }, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(
  JSON.stringify({
    status:
      phase === "before"
        ? "PASS_0033_PRESTATE_CAPTURE"
        : "PASS_0033_TARGETED_SQL_ONLY",
    checks,
    ownerConnectionClosed: true,
  }),
);
