/** Emit 0029 once from two completely frozen private sources. No DB writes. */
import { readFile, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { z } from "zod";
import { canonicalP1Json as canonical } from "../src/features/quizpack/v1/canonical";
import { quizPackContentV3Schema } from "../src/features/quizpack/content/v3";
import { persistedReportSnapshotV2Schema } from "../src/features/report/persisted/snapshot-contract-v2";
import { baselineDescriptorV2Schema } from "../src/features/product/internal-versions/baseline-schema-v2";
import oldRegistration from "../src/features/quizpack/content/private-test-registration-rebuild.json";
import oldBaseline from "../src/features/product/internal-versions/baselines/qztx-private-rebuild-20261031.json";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const digest = z.string().regex(/^(?!0{64}$)[a-f0-9]{64}$/),
  identifier = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const registrationSchema = z.object({
  schemaVersion: z.literal("quizforge.private-test-registration.v1"),
  instanceId: z.string().regex(/^[a-f0-9]{32}$/),
  origin: z.enum(["http://127.0.0.1:63226", "http://127.0.0.1:63227"]),
  productId: z.literal("qianzai-tongxin"),
  authorizationId: z.literal("qztx-final-private-20261103"),
  canonicalContentSha256: digest,
  assetSetSha256: digest,
  canonicalManifestSha256: digest,
  resources: z.array(z.unknown()).min(20),
});
const read = async (file: string) => readFile(file, "utf8");
const json = async (file: string) => JSON.parse(await read(file));
const args = z.tuple([z.string(), z.string()]).parse(process.argv.slice(2));
const candidates: {
  r: z.infer<typeof registrationSchema>;
  baseline: z.infer<typeof baselineDescriptorV2Schema>;
  resources: z.infer<typeof quizPackContentV3Schema>["bindings"]["resources"];
}[] = [];
for (const directory of args) {
  assert.equal(path.isAbsolute(directory), true);
  assert.equal(await realpath(directory), directory);
  assert.ok(directory.startsWith(process.cwd() + "/.cache/"));
  const r = registrationSchema.parse(
    await json(directory + "/registration.json"),
  );
  const content = quizPackContentV3Schema.parse(
      await json(directory + "/content.json"),
    ),
    baseline = baselineDescriptorV2Schema.parse(
      await json(directory + "/baseline.json"),
    ),
    manifest = await json(directory + "/manifest.json");
  assert.equal(sha(canonical(content)), r.canonicalContentSha256);
  assert.equal(sha(canonical(manifest, "manifest")), r.canonicalManifestSha256);
  assert.equal(content.bindings.privateTestUse?.instanceId, r.instanceId);
  assert.equal(baseline.productId, r.productId);
  assert.equal(baseline.canonicalContentSha256, r.canonicalContentSha256);
  assert.equal(baseline.assetSetSha256, r.assetSetSha256);
  assert.equal(baseline.canonicalManifestSha256, r.canonicalManifestSha256);
  assert.equal(baseline.approval.kind, "private-test-only");
  if (baseline.approval.kind !== "private-test-only")
    throw Error("PRIVATE_APPROVAL_REQUIRED");
  assert.equal(baseline.approval.instanceId, r.instanceId);
  assert.equal(baseline.approval.authorizationId, r.authorizationId);
  identifier.parse(baseline.id);
  const assetSet = {
    schemaVersion: "quizpack-candidate-asset-set.v1",
    productId: r.productId,
    resources: content.bindings.resources
      .map((x) => ({
        productId: x.productId,
        resourceId: x.id,
        resourceVersion: x.version,
        blobSha256: x.sha256,
        declarationSha256: sha(canonical(x)),
      }))
      .sort((a, b) => a.resourceId.localeCompare(b.resourceId, "en")),
  };
  assert.equal(sha(canonical(assetSet)), r.assetSetSha256);
  candidates.push({ r, baseline, resources: content.bindings.resources });
}
assert.deepEqual(candidates.map((c) => c.r.origin).sort(), [
  "http://127.0.0.1:63226",
  "http://127.0.0.1:63227",
]);
assert.equal(new Set(candidates.map((c) => c.r.instanceId)).size, 2);
assert.equal(
  new Set(candidates.map((c) => c.r.canonicalContentSha256)).size,
  2,
);
const prior = await read("migrations/p2a/0028_private_test_role_composite.sql");
function fn(name: string) {
  const m = new RegExp(`CREATE(?: OR REPLACE)? FUNCTION qf\\.${name}\\(`).exec(
    prior,
  );
  assert.ok(m, "MISSING_PREVIOUS_FUNCTION " + name);
  const text = prior.slice(m.index),
    delimiter = name === "consumer_schema_v2" ? "$schema$" : "$$",
    open = text.indexOf(delimiter),
    end = text.indexOf(delimiter + ";", open + delimiter.length);
  assert.ok(open >= 0 && end > open);
  return text
    .slice(0, end + delimiter.length + 1)
    .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
}
function replaceOnce(s: string, from: string, to: string) {
  assert.equal(s.split(from).length, 2, "EXACT_PREVIOUS_BRANCH_REQUIRED");
  return s.replace(from, to);
}
const quote = (s: string) => "'" + s.replaceAll("'", "''") + "'";
type Registration = Pick<
  typeof oldRegistration,
  | "instanceId"
  | "authorizationId"
  | "productId"
  | "canonicalContentSha256"
  | "assetSetSha256"
  | "canonicalManifestSha256"
>;
const db = (r: Registration) =>
  `(current_database()='qf_db_${r.instanceId}' AND shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database')='quizforge.p2a.v1:${r.instanceId}:test')`;
const marker = (r: Registration) =>
  canonical({
    schemaVersion: "quizforge.private-test-use.v1",
    instanceId: r.instanceId,
    authorizationId: r.authorizationId,
    contentStatus: "candidate",
    resourceStatus: "reference-or-candidate",
  });
const branch = (r: Registration) =>
  `(${db(r)} AND source#>'{bindings,privateTestUse}'=${quote(marker(r))}::jsonb AND qf.sha256_utf8(qf.consumer_canonical(source))='${r.canonicalContentSha256}' AND asset_sha='${r.assetSetSha256}' AND manifest_sha='${r.canonicalManifestSha256}')`;
const review = (r: Registration, b: (typeof candidates)[number]["baseline"]) =>
  `(a=${quote(canonical(b.approval))}::jsonb AND r.product_id='${r.productId}' AND r.canonical_content_sha256::text='${r.canonicalContentSha256}' AND r.asset_set_sha256::text='${r.assetSetSha256}' AND r.canonical_manifest_sha256::text='${r.canonicalManifestSha256}' AND b->'baseline'=${quote(canonical({ kind: "baseline", id: b.id, version: b.version, entrySha256: sha(canonical(b)) }))}::jsonb)`;
const names = [
  "consumer_schema_v2",
  "composed_assets_v1",
  "private_test_database_valid",
  "private_test_structure_valid",
  "private_test_source_valid",
  "product_asset_declaration_valid",
  "internal_review_valid",
] as const;
const previous = Object.fromEntries(
  [...names, "protect_internal_reference"].map((n) => [n, fn(n)]),
);
const statements: Record<string, string> = {};
statements.consumer_schema_v2 = previous.consumer_schema_v2!.replace(
  /WHEN '(content|report)' THEN \$qztx_schema\$[^]*?\$qztx_schema\$/g,
  (_, kind) =>
    `WHEN '${kind}' THEN $qztx_schema$${JSON.stringify(z.toJSONSchema(kind === "content" ? quizPackContentV3Schema : persistedReportSnapshotV2Schema, { target: "draft-2020-12", io: "input", unrepresentable: "throw" }))}$qztx_schema$`,
);
assert.notEqual(statements.consumer_schema_v2, previous.consumer_schema_v2);
// Optional navigation is a declared neutral slot, collected by the existing TS projection.
// Missing navigation contributes no reference, preserving all previous source outputs.
statements.composed_assets_v1 = replaceOnce(
  previous.composed_assets_v1!,
  "(VALUES(a->'background'),(a->'questionPaper'),(a->'optionIdle'),(a->'optionSelected')) r(ref)",
  "(VALUES(a->'background'),(a->'navigation'),(a->'questionPaper'),(a->'optionIdle'),(a->'optionSelected')) r(ref) WHERE ref IS NOT NULL",
);

const oldSelect = previous.private_test_database_valid!.split("$$")[1]!.trim();
assert.ok(oldSelect.startsWith("SELECT "));
statements.private_test_database_valid = `CREATE OR REPLACE FUNCTION qf.private_test_database_valid() RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ ${oldSelect} OR ${candidates.map((c) => db(c.r)).join(" OR ")} $$;`;
const oldMarker = `source#>'{bindings,privateTestUse}'=${quote(marker(oldRegistration))}::jsonb`;
statements.private_test_structure_valid = replaceOnce(
  previous.private_test_structure_valid!,
  oldMarker,
  `(${oldMarker} OR ${candidates.map((c) => `source#>'{bindings,privateTestUse}'=${quote(marker(c.r))}::jsonb`).join(" OR ")})`,
);
statements.private_test_source_valid = replaceOnce(
  previous.private_test_source_valid!,
  branch(oldRegistration),
  [branch(oldRegistration), ...candidates.map((c) => branch(c.r))].join(" OR "),
);
let declarationEdits = 0;
statements.product_asset_declaration_valid =
  previous.product_asset_declaration_valid!.replace(
    /qf\.sha256_utf8\(qf\.consumer_canonical\(d\)\) IN \(([^)]+)\)/,
    (_all, list) => {
      declarationEdits++;
      const oldHashes = new Set(
        [...list.matchAll(/'([a-f0-9]{64})'/g)].map((m) => m[1]),
      );
      return `(qf.sha256_utf8(qf.consumer_canonical(d)) IN (${list}) OR ${candidates
        .map((c) => {
          const added = [
            ...new Set(
              c.resources
                .map((r) => sha(canonical(r)))
                .filter((h) => !oldHashes.has(h)),
            ),
          ].sort();
          assert.ok(added.length > 0);
          return `(${db(c.r)} AND qf.sha256_utf8(qf.consumer_canonical(d)) IN (${added.map(quote).join(",")}))`;
        })
        .join(" OR ")})`;
    },
  );
assert.equal(declarationEdits, 1);
const oldReview = review(
  oldRegistration,
  baselineDescriptorV2Schema.parse(oldBaseline),
);
statements.internal_review_valid = replaceOnce(
  previous.internal_review_valid!,
  `AND (${oldReview} OR (`,
  `AND (${candidates.map((c) => `(${db(c.r)} AND ${review(c.r, c.baseline)})`).join(" OR ")} OR ${oldReview} OR (`,
);
// The new exact instance fence reads pg_database metadata; keep planner volatility accurate.
statements.internal_review_valid = statements.internal_review_valid.replace(
  "LANGUAGE plpgsql IMMUTABLE STRICT",
  "LANGUAGE plpgsql STABLE STRICT",
);
const signatures: Record<string, string> = {
  consumer_schema_v2: "text",
  composed_assets_v1: "jsonb,jsonb",
  private_test_database_valid: "",
  private_test_structure_valid: "jsonb",
  private_test_source_valid: "jsonb,text,text",
  product_asset_declaration_valid: "text,text,text,text,text,text",
  internal_review_valid: "qf.draft_review",
  protect_internal_reference: "",
};
function guard(name: string, definition: string) {
  const delim = name === "consumer_schema_v2" ? "$schema$" : "$$",
    body = definition.split(delim)[1]!;
  const stable = /LANGUAGE (?:sql|plpgsql) STABLE/.test(definition),
    immutable = /LANGUAGE (?:sql|plpgsql) IMMUTABLE/.test(definition),
    strict = /\bSTRICT\b/.test(definition.slice(0, definition.indexOf(delim))),
    language = /LANGUAGE sql/.test(definition) ? "sql" : "plpgsql",
    returns =
      name === "consumer_schema_v2" || name === "composed_assets_v1"
        ? "jsonb"
        : name === "protect_internal_reference"
          ? "trigger"
          : "boolean";
  return `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='qf.${name}(${signatures[name]})'::regprocedure AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='${sha(body)}' AND provolatile='${immutable ? "i" : stable ? "s" : "v"}' AND proisstrict=${strict} AND NOT prosecdef AND NOT proretset AND NOT proleakproof AND prokind='f' AND pronargdefaults=0 AND prorettype='${returns}'::regtype AND prolang=(SELECT oid FROM pg_language WHERE lanname='${language}') AND proconfig=ARRAY['search_path=pg_catalog']) THEN RAISE EXCEPTION 'FINAL_PRIVATE_HELPER_CHANGED:${name}'; END IF; END $$;\n`;
}
const prefix = prior.slice(
  prior.indexOf("LOCK TABLE"),
  prior.indexOf("DO $$ BEGIN IF NOT EXISTS"),
);
assert.ok(prefix.includes("D3_UNSETTLED_IO"));
let sql =
  "-- Exact final candidate admission for two isolated owned test instances.\n-- Append-only: previous checksums, snapshots, ACL and owner fences remain.\n" +
  prefix;
for (const name of [...names, "protect_internal_reference"])
  sql += guard(name, previous[name]!);
sql += "\n" + names.map((n) => statements[n]).join("\n\n") + "\n";
for (const name of names) sql += guard(name, statements[name]!);
sql += guard(
  "protect_internal_reference",
  previous.protect_internal_reference!,
);
const finalChecks = prior.slice(
  prior.indexOf(
    "DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL",
  ),
  prior.indexOf("\n", prior.lastIndexOf("ROLE_COMPOSITE_EXISTING_REPORT")),
);
assert.ok(finalChecks.includes("ROLE_COMPOSITE_PUBLIC_EXECUTE"));
assert.ok(finalChecks.includes("ROLE_COMPOSITE_EXISTING_REPORT"));
sql += finalChecks + "\n";
assert.ok(!sql.includes("0".repeat(64)));
await writeFile("migrations/p2a/0029_private_test_final_candidate.sql", sql, {
  flag: "wx",
});
console.log(
  JSON.stringify({
    generated: true,
    bytes: Buffer.byteLength(sql),
    sha256: sha(sql),
    sources: candidates.map((c) => ({
      instanceId: c.r.instanceId,
      source: c.r.canonicalContentSha256,
      baseline: c.baseline.id,
    })),
  }),
);
