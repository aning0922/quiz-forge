import path from "node:path";
import type postgres from "postgres";
/** Directed checks against the owned 3293 test DB. No native provisioning,
 * records, credentials, raw author answers, or PNG pixels are emitted. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { loadRuntimeConfig, readPrivateJson } from "../src/lib/db/runtime";
import { openSql, verifyDatabaseIdentity } from "../src/lib/db/client";
import {
  privateTestUseSchema,
  privateTestSourceMatches,
  privateTestAssetMatches,
  PRIVATE_TEST_REGISTRATIONS,
} from "../src/features/quizpack/content/private-test";
import { baselineApprovalSchema } from "../src/features/product/internal-versions/identity-contracts";
import { canonicalP1Json as canonical } from "../src/features/quizpack/v1/canonical";
import { quizPackContentV3Schema } from "../src/features/quizpack/content/v3";
import { persistedReportSnapshotV2Schema } from "../src/features/report/persisted/snapshot-contract-v2";
import { assertPrivateTestSource } from "../src/features/quizpack/private-test-scope";
import O from "../src/features/quizpack/content/private-test-registration.json";
import R from "../src/features/quizpack/content/private-test-registration-rebuild.json";
const candidate = process.argv[2];
if (!candidate?.startsWith(".cache/qztx-prototype-rebuild/candidate-"))
  throw Error("OWNED_CANDIDATE_REQUIRED");
const read = async (f: string) => JSON.parse(await readFile(f, "utf8"));
const content = await read(candidate + "/content.json"),
  baseline = await read(candidate + "/baseline.json");
const oldContent = await read(
  "/Users/aipuli/.codex/worktrees/quizforge-qztx-full-flow-demo/quiz-forge/.cache/qztx-full-flow/candidate-02/content.json",
);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const facts = (r: typeof O | typeof R) => ({
  productId: r.productId,
  canonicalContentSha256: r.canonicalContentSha256,
  assetSetSha256: r.assetSetSha256,
  canonicalManifestSha256: r.canonicalManifestSha256,
});
const checks: { name: string; passed: true }[] = [];
const ok = (name: string, value: unknown) => {
  assert.equal(value, true, name);
  checks.push({ name, passed: true });
};
for (const r of PRIVATE_TEST_REGISTRATIONS) {
  ok("ts-source:" + r.authorizationId, privateTestSourceMatches(facts(r)));
  ok(
    "ts-marker:" + r.authorizationId,
    privateTestUseSchema.safeParse({
      schemaVersion: "quizforge.private-test-use.v1",
      instanceId: r.instanceId,
      authorizationId: r.authorizationId,
      contentStatus: "candidate",
      resourceStatus: "reference-or-candidate",
    }).success,
  );
}
for (const [a, b] of [
  [O, R],
  [R, O],
]) {
  ok(
    "ts-cross-marker-rejected:" + a!.authorizationId,
    !privateTestUseSchema.safeParse({
      ...content.bindings.privateTestUse,
      instanceId: a!.instanceId,
      authorizationId: b!.authorizationId,
    }).success,
  );
  ok(
    "ts-cross-source-rejected:" + a!.authorizationId,
    !privateTestSourceMatches({
      ...facts(a!),
      assetSetSha256: b!.assetSetSha256,
    }),
  );
  ok(
    "ts-cross-approval-rejected:" + a!.authorizationId,
    !baselineApprovalSchema.safeParse({
      ...baseline.approval,
      instanceId: a!.instanceId,
      authorizationId: b!.authorizationId,
    }).success,
  );
}
const config = await loadRuntimeConfig();
assert.equal(config.instanceId, R.instanceId);
assert.equal(config.origin, R.origin);
assert.equal(config.database.port, 55493);
const sql = openSql(config.database, 1);
try {
  const [identity] =
    await sql`SELECT current_database() AS db,current_user AS role,inet_server_port() AS port,shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS marker`;
  assert.ok(identity);
  ok(
    "actual-app-role-and-marker",
    identity.db === `qf_db_${R.instanceId}` &&
      identity.role === `qf_app_${R.instanceId}` &&
      identity.port === 55493 &&
      identity.marker === `quizforge.p2a.v1:${R.instanceId}:test`,
  );
  for (const [kind, schema] of [
    ["content", quizPackContentV3Schema],
    ["report", persistedReportSnapshotV2Schema],
  ] as const) {
    const [row] = await sql`SELECT qf.consumer_schema_v2(${kind}) AS schema`;
    assert.ok(row);
    assert.deepEqual(
      row.schema,
      z.toJSONSchema(schema, {
        target: "draft-2020-12",
        io: "input",
        unrepresentable: "throw",
      }),
    );
    checks.push({ name: "actual-db-schema:" + kind, passed: true });
  }
  const [shape] =
    await sql`SELECT jsonb_typeof(${JSON.stringify(content)}::text::jsonb) AS type`;
  assert.ok(shape);
  ok("verification-parameter-is-object", shape.type === "object");
  const sourceValid = async (
    source: unknown,
    asset = R.assetSetSha256,
    manifest = R.canonicalManifestSha256,
  ) => {
    const [r] =
      await sql`SELECT qf.private_test_source_valid(${JSON.stringify(source)}::text::jsonb,${asset},${manifest}) IS TRUE AS valid`;
    assert.ok(r);
    return r.valid;
  };
  ok("new-exact-source", await sourceValid(content));
  ok(
    "old-source-rejected-in-new-db",
    !(await sourceValid(
      oldContent,
      O.assetSetSha256,
      O.canonicalManifestSha256,
    )),
  );
  for (const a of [R.assetSetSha256, O.assetSetSha256])
    for (const m of [R.canonicalManifestSha256, O.canonicalManifestSha256])
      if (a !== R.assetSetSha256 || m !== R.canonicalManifestSha256)
        ok(
          "new-cross-hash-combination-rejected:" +
            a.slice(0, 4) +
            m.slice(0, 4),
          !(await sourceValid(content, a, m)),
        );
  for (const mutation of [
    {
      ...content,
      bindings: {
        ...content.bindings,
        privateTestUse: oldContent.bindings.privateTestUse,
      },
    },
    {
      ...content,
      bindings: {
        ...content.bindings,
        privateTestUse: {
          ...content.bindings.privateTestUse,
          authorizationId: O.authorizationId,
        },
      },
    },
    { ...content, core: { ...content.core, title: "tampered" } },
  ])
    ok("mutated-source-rejected", !(await sourceValid(mutation)));
  for (const legacy of [
    {},
    { core: { schemaVersion: "legacy" } },
    { bindings: { kind: "authored" } },
  ])
    ok("legacy-no-marker-coalesce", await sourceValid(legacy));
  const [body] =
    await sql`SELECT qf.consumer_body_valid_v2(${canonical(content)},'content',2097152) AS valid`;
  assert.ok(body);
  ok("new-content-database-schema", body.valid);
  const selected = content.bindings.slots.characters.find(
      (c: { resultRef: { id: string } }) => c.resultRef.id === "li-bai",
    ),
    other = content.bindings.slots.characters.find(
      (c: { resultRef: { id: string } }) => c.resultRef.id !== "li-bai",
    );
  const [l] =
      await sql`SELECT qf.composed_assets_v1(${JSON.stringify(content)}::text::jsonb,${JSON.stringify(selected)}::text::jsonb) AS assets`,
    [o] =
      await sql`SELECT qf.composed_assets_v1(${JSON.stringify(content)}::text::jsonb,${JSON.stringify(other)}::text::jsonb) AS assets`;
  assert.ok(l);
  assert.ok(o);
  const pairIds = [
    selected.revealComposite.before.id,
    selected.revealComposite.full.id,
  ];
  ok(
    "selected-role-includes-two-composites",
    pairIds.every((id) =>
      l.assets.some(
        (a: { resourceRef: { id: string }; purpose: string }) =>
          a.resourceRef.id === id && a.purpose === "decoration",
      ),
    ),
  );
  ok(
    "other-role-prunes-both-composites",
    pairIds.every(
      (id) =>
        !o.assets.some(
          (a: { resourceRef: { id: string } }) => a.resourceRef.id === id,
        ),
    ),
  );
  const added = content.bindings.resources.filter((r: { id: string }) =>
    pairIds.includes(r.id),
  );
  const checkDeclarations = async (
    declarationSql: postgres.Sql | postgres.TransactionSql,
  ) => {
    for (const asset of added) {
      const [r] =
        await declarationSql`SELECT qf.product_asset_declaration_valid(${asset.productId},${asset.id},${asset.version},${asset.sha256},${asset.purpose},${canonical(asset)}) AS valid`;
      assert.ok(r);
      ok("exact-declaration:" + asset.id, r.valid);
      ok(
        "ts-exact-resource:" + asset.id,
        privateTestAssetMatches({
          ...asset,
          resourceRef: {
            productId: asset.productId,
            id: asset.id,
            version: asset.version,
          },
        }),
      );
      for (const mutation of [
        { ...asset, purpose: "portrait" },
        { ...asset, license: { ...asset.license, commercialUse: true } },
        { ...asset, source: { ...asset.source, attribution: "changed" } },
      ]) {
        const [r] =
          await declarationSql`SELECT qf.product_asset_declaration_valid(${mutation.productId},${mutation.id},${mutation.version},${mutation.sha256},${mutation.purpose},${canonical(mutation)}) AS valid`;
        assert.ok(r);
        ok("mutated-declaration-rejected:" + asset.id, !r.valid);
      }
    }
  };
  const admin = (await readPrivateJson(
    path.resolve(`.cache/p2a/${R.instanceId}/admin.json`),
  )) as { instanceId: string; owner: typeof config.database };
  assert.equal(admin.instanceId, R.instanceId);
  assert.equal(admin.owner.user, `qf_owner_${R.instanceId}`);
  const owner = openSql(admin.owner, 1);
  try {
    await verifyDatabaseIdentity(owner, config, admin.owner.user);
    const [before] =
      await owner`SELECT count(*)::int AS n FROM qf.asset_blob WHERE sha256=ANY(${owner.array(added.map((a: { sha256: string }) => a.sha256))}::text[])`;
    assert.ok(before);
    if (before.n === 2) {
      await checkDeclarations(sql);
      checks.push({
        name: "declarations-using-existing-native-blobs",
        passed: true,
      });
    } else {
      assert.equal(
        before.n,
        0,
        "no partial native provisioning may be overwritten",
      );
      const rollback = new Error("ROLLBACK_OWNED_DECLARATION_FIXTURE");
      await owner
        .begin(async (tx) => {
          for (const a of added)
            await tx`INSERT INTO qf.asset_blob(sha256,bytes,media_type,width,height,frames,storage_key,created_at) VALUES(${a.sha256},${a.bytes},${a.mediaType},${a.width},${a.height},1,${"blobs/" + a.sha256 + ".blob"},current_timestamp)`;
          await checkDeclarations(tx);
          throw rollback;
        })
        .catch((e) => {
          if (e !== rollback) throw e;
        });
      const [after] =
        await owner`SELECT count(*)::int AS n FROM qf.asset_blob WHERE sha256=ANY(${owner.array(added.map((a: { sha256: string }) => a.sha256))}::text[])`;
      assert.ok(after);
      ok("declaration-fixture-transaction-actually-rolled-back", after.n === 0);
    }
  } finally {
    await owner.end({ timeout: 3 });
  }
  await assertPrivateTestSource(sql, content, facts(R));
  checks.push({ name: "ts-actual-db-source-scope", passed: true });
  await assert.rejects(assertPrivateTestSource(sql, oldContent, facts(O)));
  checks.push({ name: "ts-old-source-cross-db-rejected", passed: true });
  const uuid = "00000000-0000-4000-8000-000000000028",
    target = {
      draftId: uuid,
      revision: 1,
      canonicalContentSha256: R.canonicalContentSha256,
      assetSetSha256: R.assetSetSha256,
      canonicalManifestSha256: R.canonicalManifestSha256,
    },
    identityBaseline = {
      kind: "baseline",
      id: baseline.id,
      version: baseline.version,
      entrySha256: sha(canonical(baseline)),
    };
  const review = async (approval: unknown, b = identityBaseline) => {
    const bindingText = canonical({
        schemaVersion: "quizforge.review-record.v1",
        productId: R.productId,
        idempotencyKey: uuid,
        target,
        baseline: b,
      }),
      factsText = canonical({
        schemaVersion: "quizforge.internal-review-facts.v1",
        productId: R.productId,
        target,
        baseline: b,
        purpose: "internal-test",
        approval,
      });
    const row = {
      product_id: R.productId,
      draft_id: uuid,
      revision: 1,
      canonical_content_sha256: R.canonicalContentSha256,
      asset_set_sha256: R.assetSetSha256,
      canonical_manifest_sha256: R.canonicalManifestSha256,
      idempotency_key: uuid,
      purpose: "internal-test",
      binding_text: bindingText,
      fingerprint: sha(bindingText),
      facts_text: factsText,
      review_sha256: sha(factsText),
    };
    const [v] =
      await sql`SELECT qf.internal_review_valid(jsonb_populate_record(NULL::qf.draft_review,${JSON.stringify(row)}::text::jsonb)) AS valid`;
    assert.ok(v);
    return v.valid;
  };
  ok("exact-review-baseline-and-evidence", await review(baseline.approval));
  ok(
    "wrong-review-evidence-rejected",
    !(await review({ ...baseline.approval, evidenceSha256: "0".repeat(64) })),
  );
  ok(
    "wrong-review-baseline-rejected",
    !(await review(baseline.approval, {
      ...identityBaseline,
      entrySha256: "0".repeat(64),
    })),
  );
  ok(
    "cross-review-instance-rejected",
    !(await review({ ...baseline.approval, instanceId: O.instanceId })),
  );
  const [acl] =
    await sql`SELECT has_function_privilege(current_user,'qf.private_test_source_valid(jsonb,text,text)','EXECUTE') AS execute,NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='qf.private_test_source_valid(jsonb,text,text)'::regprocedure AND a.grantee=0) AS private`;
  assert.ok(acl);
  ok("function-app-execute-without-public", acl.execute && acl.private);
  await writeFile(
    candidate + "/db-source-verification.json",
    JSON.stringify(
      {
        passed: true,
        instanceId: R.instanceId,
        origin: R.origin,
        source: facts(R),
        checks,
        qualification:
          "Actual PostgreSQL app-role source/schema/pruning/review checks; declaration checks use owner metadata fixtures in a rolled-back transaction. No native decode/import/provision or author acceptance.",
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    JSON.stringify({ passed: true, checks: checks.length, source: facts(R) }),
  );
} finally {
  await sql.end({ timeout: 3 });
}
