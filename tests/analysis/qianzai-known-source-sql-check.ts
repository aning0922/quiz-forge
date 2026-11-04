/** Exact finite owned SQL admission checks, not native media or consumer evidence. */
import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { openManagedDatabase } from "../../src/lib/db/management";
import { CONSUMER_CATALOG_QUERY } from "../../src/lib/db/consumer-catalog";
import { canonicalP1Json as canonical } from "../../src/features/quizpack/v1/canonical";
import { quizPackContentV3Schema } from "../../src/features/quizpack/content/v3";
import previousRegistration from "../../src/features/quizpack/content/private-test-registration-known-ten-final.json";
import experienceRegistration from "../../src/features/quizpack/content/private-test-registration-known-ten-experience.json";
import previousBaseline from "../../src/features/product/internal-versions/baselines/qztx-known-ten-private-20261104.json";
import experienceBaseline from "../../src/features/product/internal-versions/baselines/qztx-known-ten-experience-20261104.json";

const [phase, mode] = process.argv.slice(2);
assert(
  (phase === "before" || phase === "after") &&
    ((process.argv.length === 3 && mode === undefined) ||
      (process.argv.length === 4 && mode === "--experience")),
);
const experience = mode === "--experience";
const registration = experience ? experienceRegistration : previousRegistration;
const baseline = experience ? experienceBaseline : previousBaseline;
const version = experience ? "0034" : "0033";
const priorCount = experience ? 33 : 32;
const out = path.join(
  process.cwd(),
  ".cache/known-ten/source-" + version + "-" + phase + ".receipt.json",
);
const sha = (text: string | Uint8Array) =>
  createHash("sha256").update(text).digest("hex");
const db = await openManagedDatabase(registration.instanceId);
const checks: string[] = [];
let result: object;
try {
  assert.equal(db.manifest.root, process.cwd());
  assert.equal(db.manifest.purpose, "test");
  assert.equal(db.manifest.port, experience ? 55538 : 55537);
  assert.equal(db.manifest.origin, registration.origin);
  const migrations =
    await db.sql`SELECT version,checksum,to_char(applied_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') applied_at_utc_microseconds FROM qf_meta.schema_migrations ORDER BY version`;
  assert.equal(
    migrations.length,
    phase === "before" ? priorCount : priorCount + 1,
  );
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
      experience
        ? "57137878c47b73d1914ace7f9198812d932727ef40d05b95d8514712762c9143"
        : "ad236ba8bc23d53c69197a6f603bb17421c8ffce9c4c745de866165ed97fa8d7",
    );
    result = {
      status: `PASS_${version}_PRESTATE_CAPTURE`,
      functions,
      catalog,
      migrations,
    };
  } else {
    const before = JSON.parse(
      await readFile(
        path.join(
          process.cwd(),
          ".cache/known-ten/source-" + version + "-before.receipt.json",
        ),
        "utf8",
      ),
    );
    assert.equal(before.status, `PASS_${version}_PRESTATE_CAPTURE`);
    assert.deepEqual(migrations.slice(0, priorCount), before.migrations);
    checks.push(
      "prior_ledger_checksums_and_native_microsecond_applied_at_unchanged",
    );
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
    if (experience) {
      const approved = JSON.parse(
        await readFile(
          ".cache/known-ten/source-0034-approved.receipt.json",
          "utf8",
        ),
      );
      assert.equal(
        approved.sha256,
        "2103ca99cb2c610c8af3d6d20d25945afaffa5aedca85fdc2a606258760f4955",
      );
      assert.equal(
        sha(
          await readFile(
            "migrations/p2a/0034_private_test_known_ten_experience.sql",
          ),
        ),
        approved.sha256,
      );
      for (const f of approved.functions) {
        const signature = `qf.${f.name}(${f.signature})`;
        assert.equal(
          before.functions.find(
            (p: { signature: string }) => p.signature === signature,
          )?.body_sha256,
          f.oldBodySha256,
        );
        assert.equal(
          functions.find((p) => p.signature === signature)?.body_sha256,
          f.newBodySha256,
        );
      }
      checks.push("all_six_old_and_actual_new_bodies_match_approved_0034");
    }
    checks.push(
      "only_six_reviewed_bodies_changed_all_function_metadata_and_acl_preserved",
    );
    const content = quizPackContentV3Schema.parse(
      JSON.parse(
        await readFile(
          path.join(
            process.cwd(),
            experience
              ? ".cache/known-ten/content-experience-v1/content.json"
              : ".cache/known-ten/content-candidate-v1/content.json",
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
      `exact_${experience ? "00486" : "b3"}_source_schema_database_marker_and_three_hashes_accept`,
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
    if (experience) {
      const oldSource = structuredClone(content);
      Reflect.set(
        oldSource.bindings.privateTestUse!,
        "instanceId",
        previousRegistration.instanceId,
      );
      Reflect.set(
        oldSource.bindings.privateTestUse!,
        "authorizationId",
        previousRegistration.authorizationId,
      );
      assert.equal(
        sha(canonical(oldSource)),
        previousRegistration.canonicalContentSha256,
      );
      assert.equal(
        await sourceValid(
          oldSource,
          previousRegistration.assetSetSha256,
          previousRegistration.canonicalManifestSha256,
        ),
        false,
      );
      checks.push("exact_old_b3_source_and_three_hashes_rejected_in_00486");
    }
    checks.push(
      "source_asset_manifest_instance_authorization_foreign_product_rejected",
    );
    const row = (
      change:
        "none" | "baseline" | "approval" | "target" | "old-approval" = "none",
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
      if (change === "old-approval")
        Object.assign(approval, previousBaseline.approval);
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
    for (const change of (experience
      ? ["none", "baseline", "approval", "target", "old-approval"]
      : ["none", "baseline", "approval", "target"]) as (
      "none" | "baseline" | "approval" | "target" | "old-approval"
    )[])
      assert.equal(
        (
          await db.sql`SELECT qf.internal_review_valid(jsonb_populate_record(NULL::qf.draft_review,${canonical(row(change))}::text::jsonb)) valid`
        )[0]!.valid,
        change === "none",
      );
    checks.push(
      "exact_baseline_accepts_and_baseline_approval_target_mix_rejects",
    );
    // Rollback-only metadata fixture. No admitted/decoded/stored blobs or import.
    const rollback = new Error("EXPECTED_METADATA_FIXTURE_ROLLBACK");
    const declarations = experience
      ? content.bindings.resources
      : [content.bindings.resources.find((r) => r.version === "3.0.0")!];
    assert.equal(declarations.length, experience ? 53 : 1);
    const accepted: string[] = [];
    let markerRejected = false;
    try {
      await db.sql.begin(async (sql) => {
        for (const declaration of declarations) {
          await sql`INSERT INTO qf.asset_blob(sha256,bytes,media_type,width,height,frames,storage_key,created_at) VALUES(${declaration.sha256},${declaration.bytes},${declaration.mediaType},${declaration.width},${declaration.height},1,${"blobs/" + declaration.sha256 + ".blob"},clock_timestamp())`;
          assert.equal(
            (
              await sql`SELECT qf.product_asset_declaration_valid(${declaration.productId},${declaration.id},${declaration.version},${declaration.sha256},${declaration.purpose},${canonical(declaration)}) valid`
            )[0]!.valid,
            true,
          );
          accepted.push(declaration.id);
        }
        const negatives = experience
          ? [
              declarations[0]!,
              declarations.find((r) => r.id === "qztx-art-act-1")!,
              declarations.find((r) => r.version === "3.0.0")!,
            ]
          : declarations;
        for (const declaration of negatives)
          for (const change of [
            "declaration",
            "ref",
            "license",
            "approval",
          ] as const) {
            const altered = structuredClone(declaration);
            if (change === "declaration") altered.source.evidence += "篡改";
            if (change === "ref") altered.id += "-other";
            if (change === "license") altered.license.redistribution = true;
            if (change === "approval") altered.approval = "approved";
            assert.equal(
              (
                await sql`SELECT qf.product_asset_declaration_valid(${altered.productId},${altered.id},${altered.version},${altered.sha256},${altered.purpose},${canonical(altered)}) valid`
              )[0]!.valid,
              false,
            );
          }
        if (experience) {
          // Database comments are transactional. The original marker must return
          // on this same acknowledged rollback, without modifying manifest files.
          assert.equal(
            (
              await sql`SELECT shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') marker`
            )[0]!.marker,
            `quizforge.p2a.v1:${registration.instanceId}:test`,
          );
          await sql.unsafe(
            `COMMENT ON DATABASE "qf_db_${registration.instanceId}" IS 'quizforge.p2a.v1:${registration.instanceId}:ci'`,
          );
          assert.equal(
            (await sql`SELECT qf.private_test_database_valid() valid`)[0]!
              .valid,
            false,
          );
          assert.equal(
            (
              await sql`SELECT qf.private_test_source_valid(${canonical(content)}::text::jsonb,${registration.assetSetSha256},${registration.canonicalManifestSha256}) valid`
            )[0]!.valid,
            false,
          );
          for (const declaration of declarations)
            assert.equal(
              (
                await sql`SELECT qf.product_asset_declaration_valid(${declaration.productId},${declaration.id},${declaration.version},${declaration.sha256},${declaration.purpose},${canonical(declaration)}) valid`
              )[0]!.valid,
              false,
            );
          markerRejected = true;
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    assert.equal(accepted.length, experience ? 53 : 1);
    if (experience) {
      assert(markerRejected);
      assert.equal(
        (
          await db.sql`SELECT shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') marker`
        )[0]!.marker,
        `quizforge.p2a.v1:${registration.instanceId}:test`,
      );
      assert.equal(await sourceValid(content), true);
      checks.push(
        "all_53_declarations_accept_and_reject_wrong_marker_transaction_rollback_restores_marker",
      );
    }
    for (const value of Object.values(await count())) assert.equal(value, 0);
    checks.push(
      "exact_declarations_accept_and_declaration_ref_license_approval_reject_rollback_confirmed",
    );
    result = {
      status: `PASS_${version}_TARGETED_SQL_ONLY`,
      declarationIdsAccepted: accepted,
      priorLedgerIncludingNativeMicrosecondTimestampsUnchanged: true,
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
        ? `PASS_${version}_PRESTATE_CAPTURE`
        : `PASS_${version}_TARGETED_SQL_ONLY`,
    checks,
    ownerConnectionClosed: true,
  }),
);
