import { CONSUMER_CATALOG_QUERY } from "../src/lib/db/consumer-catalog";
/** Prepare reviewable SQL only; no DB or migration-directory writes. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { canonicalP1Json as canonical } from "../src/features/quizpack/v1/canonical";
import { quizPackContentV3Schema } from "../src/features/quizpack/content/v3";
import { baselineDescriptorV2Schema } from "../src/features/product/internal-versions/baseline-schema-v2";
import previousRegistration from "../src/features/quizpack/content/private-test-registration-known-ten-final.json";
import experienceRegistration from "../src/features/quizpack/content/private-test-registration-known-ten-experience.json";
import previousBaseline from "../src/features/product/internal-versions/baselines/qztx-known-ten-private-20261104.json";
import experienceBaseline from "../src/features/product/internal-versions/baselines/qztx-known-ten-experience-20261104.json";

const sha = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const [candidatePath, outputPath, mode] = process.argv.slice(2);
assert(
  candidatePath &&
    outputPath &&
    ((process.argv.length === 4 && mode === undefined) ||
      (process.argv.length === 5 && mode === "--experience")),
);
const experience = mode === "--experience";
const registration = experience ? experienceRegistration : previousRegistration;
const baselineInput = experience ? experienceBaseline : previousBaseline;
const proposedVersion = experience ? "0034" : "0033";
const predecessorPath = experience
  ? "migrations/p2a/0033_private_test_known_ten.sql"
  : "migrations/p2a/0029_private_test_final_candidate.sql";
const expectedCatalog = experience
  ? "57137878c47b73d1914ace7f9198812d932727ef40d05b95d8514712762c9143"
  : "ad236ba8bc23d53c69197a6f603bb17421c8ffce9c4c745de866165ed97fa8d7";
const candidate = await realpath(candidatePath),
  out = path.resolve(outputPath);
assert(out.startsWith(process.cwd() + "/.cache/known-ten/"));
assert.equal(await realpath(path.dirname(out)), path.dirname(out));
const content = quizPackContentV3Schema.parse(
  JSON.parse(await readFile(path.join(candidate, "content.json"), "utf8")),
);
assert.equal(sha(canonical(content)), registration.canonicalContentSha256);
const baseline = baselineDescriptorV2Schema.parse(baselineInput);
for (const field of [
  "canonicalContentSha256",
  "assetSetSha256",
  "canonicalManifestSha256",
] as const)
  assert.equal(baseline[field], registration[field]);
const pack = JSON.parse(
  await readFile(path.join(candidate, "private-pack-receipt.json"), "utf8"),
);
assert.equal(pack.status, "PASS_PRIVATE_PACK_BUILD_ONLY");
assert.equal(pack.report.candidateValid, true);
assert.equal(pack.report.manifestSha256, registration.canonicalManifestSha256);
assert.equal(pack.registration.instanceId, registration.instanceId);
assert.equal(
  sha(await readFile(path.join(candidate, "known-ten.zip"))),
  pack.archive.sha256,
);
const prior = await readFile(predecessorPath, "utf8");
if (experience)
  assert.equal(
    sha(prior),
    "b8fd2bb808b5784145e03025d11a25f29029f752211a975f64df5e9d9bd91290",
  );
const signatures = {
  consumer_schema_v2: "text",
  private_test_database_valid: "",
  private_test_structure_valid: "jsonb",
  private_test_source_valid: "jsonb,text,text",
  product_asset_declaration_valid: "text,text,text,text,text,text",
  internal_review_valid: "qf.draft_review",
} as const;
type Name = keyof typeof signatures;
function extract(name: Name) {
  const start = prior.indexOf(`CREATE OR REPLACE FUNCTION qf.${name}(`);
  assert(start >= 0);
  const delimiter = name === "consumer_schema_v2" ? "$schema$" : "$$";
  const open = prior.indexOf(delimiter, start),
    end = prior.indexOf(delimiter + ";", open + delimiter.length);
  assert(open > start && end > open);
  return prior.slice(start, end + delimiter.length + 1);
}
function once(text: string, from: string, to: string) {
  assert.equal(text.split(from).length, 2, "EXACT_PRIOR_BRANCH_REQUIRED");
  return text.replace(from, to);
}
const previous = Object.fromEntries(
  Object.keys(signatures).map((n) => [n, extract(n as Name)]),
) as Record<Name, string>;
const next = { ...previous };
const db = `(current_database()='qf_db_${registration.instanceId}' AND shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database')='quizforge.p2a.v1:${registration.instanceId}:test')`;
const marker = canonical({
  schemaVersion: "quizforge.private-test-use.v1",
  instanceId: registration.instanceId,
  authorizationId: registration.authorizationId,
  contentStatus: "candidate",
  resourceStatus: "reference-or-candidate",
});
const sourceBranch = `(${db} AND source#>'{bindings,privateTestUse}'=${quote(marker)}::jsonb AND qf.sha256_utf8(qf.consumer_canonical(source))='${registration.canonicalContentSha256}' AND asset_sha='${registration.assetSetSha256}' AND manifest_sha='${registration.canonicalManifestSha256}')`;
const oldDbBody = previous.private_test_database_valid.split("$$")[1]!;
next.private_test_database_valid = once(
  previous.private_test_database_valid,
  oldDbBody,
  oldDbBody.trimEnd() + " OR " + db + " ",
);
next.private_test_structure_valid = once(
  previous.private_test_structure_valid,
  "AND (source#>'{bindings,privateTestUse}'=",
  `AND (source#>'{bindings,privateTestUse}'=${quote(marker)}::jsonb OR source#>'{bindings,privateTestUse}'=`,
);
next.private_test_source_valid = once(
  previous.private_test_source_valid,
  "RETURN (qf.private_test_structure_valid(source) AND (",
  `RETURN (qf.private_test_structure_valid(source) AND (${sourceBranch} OR `,
);
const declarations = [
  ...new Set(content.bindings.resources.map((r) => sha(canonical(r)))),
].sort();
const oldDeclarationHash = previous.product_asset_declaration_valid.match(
  /qf\.sha256_utf8\(qf\.consumer_canonical\(d\)\) IN \(([^)]+)\)/,
);
assert(oldDeclarationHash);
const existing = new Set(
  [
    ...previous.product_asset_declaration_valid.matchAll(/'([a-f0-9]{64})'/g),
  ].map((m) => m[1]),
);
// The first list has only six of this pack's shared declarations. Seven other
// shared declarations occur only in older instance-scoped branches. Admit the
// complete exact 53-declaration set inside 00486's own branch; never make the
// prior scoped declarations global or borrow another instance's authority.
const added = experience
  ? declarations
  : declarations.filter((h) => !existing.has(h));
assert.equal(added.length, experience ? 53 : 40);
const globallyExisting = new Set(
  [...oldDeclarationHash[0].matchAll(/'([a-f0-9]{64})'/g)].map((m) => m[1]),
);
if (experience)
  assert.equal(declarations.filter((h) => globallyExisting.has(h)).length, 6);
next.product_asset_declaration_valid = once(
  previous.product_asset_declaration_valid,
  oldDeclarationHash[0],
  `(${oldDeclarationHash[0]} OR (${db} AND qf.sha256_utf8(qf.consumer_canonical(d)) IN (${added.map(quote).join(",")})))`,
);
const review = `(${db} AND a=${quote(canonical(baseline.approval))}::jsonb AND r.product_id='${registration.productId}' AND r.canonical_content_sha256::text='${registration.canonicalContentSha256}' AND r.asset_set_sha256::text='${registration.assetSetSha256}' AND r.canonical_manifest_sha256::text='${registration.canonicalManifestSha256}' AND b->'baseline'=${quote(canonical({ kind: "baseline", id: baseline.id, version: baseline.version, entrySha256: sha(canonical(baseline)) }))}::jsonb)`;
next.internal_review_valid = once(
  previous.internal_review_valid,
  "\n AND (((current_database()",
  `\n AND (${review} OR ((current_database()`,
);
const schema = JSON.stringify(
  z.toJSONSchema(quizPackContentV3Schema, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "throw",
  }),
);
const schemaBranch = previous.consumer_schema_v2.match(
  /WHEN 'content' THEN \$qztx_schema\$[^]*?\$qztx_schema\$/,
);
assert(schemaBranch);
next.consumer_schema_v2 = once(
  previous.consumer_schema_v2,
  schemaBranch[0],
  `WHEN 'content' THEN $qztx_schema$${schema}$qztx_schema$`,
);
const names = Object.keys(signatures) as Name[];
const body = (name: Name, value: string) =>
  value.split(name === "consumer_schema_v2" ? "$schema$" : "$$")[1]!;
function guard(name: Name, value: string) {
  return `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='qf.${name}(${signatures[name]})'::regprocedure AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='${sha(body(name, value))}' AND proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND proconfig=ARRAY['search_path=pg_catalog'] AND NOT prosecdef) THEN RAISE EXCEPTION 'KNOWN_TEN_HELPER_CHANGED:${name}' USING ERRCODE='55000'; END IF; END $$;\n`;
}
const migration0032 = await readFile(
  "migrations/p2a/0032_consumer_activation_product_selector.sql",
);
assert.equal(
  sha(migration0032),
  "1266d0362702472c98326deb113d980289deb1d37d7646550abd533bd6d78315",
);
const priorChecksum = sha(prior);
const predecessorVersion = path.basename(predecessorPath, ".sql");
const oids = names
  .map((name) => `'qf.${name}(${signatures[name]})'::regprocedure`)
  .join(",");
let sql = `-- Proposed ${proposedVersion}: exact known-ten candidate in one finite private test identity.\n-- Review candidate only; migration slot and execution require controller coordination.\nDO $pre$ DECLARE actual text; BEGIN
 IF NOT pg_try_advisory_xact_lock(72461,2) THEN RAISE EXCEPTION 'CONSUMER_IO_PRESENT' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND usename=replace(current_user,'qf_owner_','qf_app_') AND pid<>pg_backend_pid()) THEN RAISE EXCEPTION 'CONSUMER_WRITERS_PRESENT' USING ERRCODE='55000'; END IF;
 SELECT sha256 INTO actual FROM (${CONSUMER_CATALOG_QUERY.trim().replace(/;$/, "")}) known_ten_prior_catalog;
 IF actual IS DISTINCT FROM '${expectedCatalog}' THEN RAISE EXCEPTION 'KNOWN_TEN_PREVIOUS_CATALOG_MISMATCH' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM qf_meta.schema_migrations WHERE version='0032_consumer_activation_product_selector' AND checksum='${sha(migration0032)}') OR NOT EXISTS(SELECT 1 FROM qf_meta.schema_migrations WHERE version='${predecessorVersion}' AND checksum='${priorChecksum}') THEN RAISE EXCEPTION 'KNOWN_TEN_PREVIOUS_SCHEMA_MISMATCH' USING ERRCODE='55000'; END IF;
END $pre$;
LOCK TABLE qf.quizpack_import,qf.quizpack_validation,qf.product_asset,qf.draft_revision,qf.draft_review,qf.product_version,qf.internal_play_version,qf.access_key,qf.consumer_session,qf.consumer_grant,qf.quiz_report IN SHARE ROW EXCLUSIVE MODE NOWAIT;
CREATE TEMP TABLE qztx_known_ten_function_guard ON COMMIT DROP AS SELECT oid,proowner,prolang,prorettype,proisstrict,provolatile,prosecdef,proleakproof,prokind,proretset,pronargdefaults,proconfig,proacl FROM pg_proc WHERE oid IN (${oids});
`;
for (const n of names) sql += guard(n, previous[n]);
sql += "\n" + names.map((n) => next[n]).join("\n\n") + "\n";
for (const n of names) sql += guard(n, next[n]);
sql += `DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_temp.qztx_known_ten_function_guard old JOIN pg_proc p ON p.oid=old.oid WHERE ROW(p.proowner,p.prolang,p.prorettype,p.proisstrict,p.provolatile,p.prosecdef,p.proleakproof,p.prokind,p.proretset,p.pronargdefaults,p.proconfig,p.proacl) IS DISTINCT FROM ROW(old.proowner,old.prolang,old.prorettype,old.proisstrict,old.provolatile,old.prosecdef,old.proleakproof,old.prokind,old.proretset,old.pronargdefaults,old.proconfig,old.proacl)) THEN RAISE EXCEPTION 'KNOWN_TEN_FUNCTION_AUTHORITY_CHANGED' USING ERRCODE='55000'; END IF; END $$;\n`;
assert(!sql.includes("0".repeat(64)));
await writeFile(out, sql, { flag: "wx", mode: 0o600 });
await writeFile(
  out + ".receipt.json",
  JSON.stringify(
    {
      status: "REVIEW_CANDIDATE_NOT_EXECUTED",
      path: out,
      sha256: sha(sql),
      bytes: Buffer.byteLength(sql),
      previous0032: sha(migration0032),
      predecessorVersion,
      predecessorChecksum: priorChecksum,
      previousCatalogSha256: expectedCatalog,
      baselineEntrySha256: sha(canonical(baseline)),
      archiveSha256: pack.archive.sha256,
      source: registration,
      newDeclarations: added.length,
      declarationScope: experience
        ? "EXACT_53_INSIDE_00486_ONLY"
        : "EXACT_40_INSIDE_B3_ONLY",
      declarationsMissingFromGlobalList: declarations.filter(
        (h) => !globallyExisting.has(h),
      ).length,
      functions: names.map((name) => ({
        name,
        signature: signatures[name],
        oldBodySha256: sha(body(name, previous[name])),
        newBodySha256: sha(body(name, next[name])),
      })),
      previousBranches: "PRESERVED_BY_EXACT_INSERTIONS",
      reportSchema: "UNCHANGED",
      slot: `${proposedVersion}_PROPOSED_NOT_RESERVED`,
      database: "NOT_ACCESSED",
    },
    null,
    2,
  ) + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(
  JSON.stringify({
    status: "REVIEW_CANDIDATE_NOT_EXECUTED",
    sha256: sha(sql),
    bytes: Buffer.byteLength(sql),
    newDeclarations: added.length,
    slot: `${proposedVersion}_PROPOSED_NOT_RESERVED`,
  }),
);
