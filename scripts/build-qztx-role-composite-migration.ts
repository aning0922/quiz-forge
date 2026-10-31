/** Append-only 0028 generator. Historical migration bytes are read, never changed. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalP1Json as canonical } from "../src/features/quizpack/v1/canonical";
import { quizPackContentV3Schema } from "../src/features/quizpack/content/v3";
import { persistedReportSnapshotV2Schema } from "../src/features/report/persisted/snapshot-contract-v2";
import R from "../src/features/quizpack/content/private-test-registration-rebuild.json";
import O from "../src/features/quizpack/content/private-test-registration.json";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
if (R.canonicalContentSha256 === "0".repeat(64))
  throw Error("EXACT_NEW_SOURCE_REQUIRED");
const read = (n: string) => readFile(`migrations/p2a/${n}`, "utf8");
const [m25, m26, m27] = await Promise.all([
  read("0025_preference_scene_slot.sql"),
  read("0026_private_test_candidate.sql"),
  read("0027_private_test_legacy_source.sql"),
]);
function fn(source: string, name: string) {
  const match = new RegExp(
    `CREATE(?: OR REPLACE)? FUNCTION qf\\.${name}\\(`,
  ).exec(source);
  if (!match) throw Error("FUNCTION_MISSING:" + name);
  const text = source.slice(match.index),
    delimiter = name === "consumer_schema_v2" ? "$schema$" : "$$",
    open = text.indexOf(delimiter),
    end = text.indexOf(delimiter + ";", open + delimiter.length);
  if (open < 0 || end < 0) throw Error("FUNCTION_END:" + name);
  return text
    .slice(0, end + delimiter.length + 1)
    .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
}
function replaceOnce(source: string, from: string, to: string) {
  if (source.split(from).length !== 2)
    throw Error("EXACT_REPLACEMENT_REQUIRED");
  return source.replace(from, to);
}
const names = [
  "consumer_schema_v2",
  "composed_assets_v1",
  "private_test_database_valid",
  "private_test_structure_valid",
  "private_test_source_valid",
  "product_asset_declaration_valid",
  "internal_review_valid",
  "protect_internal_reference",
];
const previous = Object.fromEntries(
  names.map((n) => [
    n,
    fn(
      n === "composed_assets_v1"
        ? m25
        : n === "private_test_source_valid"
          ? m27
          : m26,
      n,
    ),
  ]),
);
const statements: Record<string, string> = {};
statements.consumer_schema_v2 = previous.consumer_schema_v2!.replace(
  /WHEN '(content|report)' THEN \$qztx_schema\$[^]*?\$qztx_schema\$/g,
  (_, kind) =>
    `WHEN '${kind}' THEN $qztx_schema$${JSON.stringify(z.toJSONSchema(kind === "content" ? quizPackContentV3Schema : persistedReportSnapshotV2Schema, { target: "draft-2020-12", io: "input", unrepresentable: "throw" }))}$qztx_schema$`,
);
if (statements.consumer_schema_v2 === previous.consumer_schema_v2)
  throw Error("SCHEMA_NOT_EXTENDED");
statements.composed_assets_v1 = replaceOnce(
  previous.composed_assets_v1!,
  " IF neutral ? 'preferenceScene'",
  ` IF chosen_character ? 'revealComposite' THEN refs:=refs||jsonb_build_array(chosen_character#>'{revealComposite,before}',chosen_character#>'{revealComposite,full}'); END IF;\n IF neutral ? 'preferenceScene'`,
);
const db = (r: typeof O | typeof R) =>
  `(current_database()='qf_db_${r.instanceId}' AND shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database')='quizforge.p2a.v1:${r.instanceId}:test')`;
const marker = (r: typeof O | typeof R) =>
  canonical({
    schemaVersion: "quizforge.private-test-use.v1",
    instanceId: r.instanceId,
    authorizationId: r.authorizationId,
    contentStatus: "candidate",
    resourceStatus: "reference-or-candidate",
  });
statements.private_test_database_valid = `CREATE OR REPLACE FUNCTION qf.private_test_database_valid() RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$ SELECT ${db(O)} OR ${db(R)} $$;`;
statements.private_test_structure_valid = replaceOnce(
  previous.private_test_structure_valid!,
  `source#>'{bindings,privateTestUse}'='${marker(O)}'::jsonb`,
  `(source#>'{bindings,privateTestUse}'='${marker(O)}'::jsonb OR source#>'{bindings,privateTestUse}'='${marker(R)}'::jsonb)`,
);
const sourceBranch = (r: typeof O | typeof R) =>
  `(${db(r)} AND source#>'{bindings,privateTestUse}'='${marker(r)}'::jsonb AND qf.sha256_utf8(qf.consumer_canonical(source))='${r.canonicalContentSha256}' AND asset_sha='${r.assetSetSha256}' AND manifest_sha='${r.canonicalManifestSha256}')`;
statements.private_test_source_valid = `CREATE OR REPLACE FUNCTION qf.private_test_source_valid(source jsonb,asset_sha text,manifest_sha text) RETURNS boolean LANGUAGE plpgsql STABLE STRICT SET search_path=pg_catalog AS $$
BEGIN
 IF coalesce((source->'bindings') ? 'privateTestUse',false) IS FALSE THEN RETURN true; END IF;
 RETURN (qf.private_test_structure_valid(source) AND (${sourceBranch(O)} OR ${sourceBranch(R)})) IS TRUE;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;`;
const candidate = process.argv[2];
if (
  !candidate ||
  !candidate.startsWith(".cache/qztx-prototype-rebuild/candidate-")
)
  throw Error("PRIVATE_CANDIDATE_REQUIRED");
const content = JSON.parse(await readFile(candidate + "/content.json", "utf8")),
  baseline = JSON.parse(await readFile(candidate + "/baseline.json", "utf8"));
if (sha(canonical(content)) !== R.canonicalContentSha256)
  throw Error("CANDIDATE_HASH_MISMATCH");
const added = content.bindings.resources.filter((r: { id: string }) =>
  r.id.startsWith("qztx-rebuild-li-bai-reveal-"),
);
if (added.length !== 2) throw Error("EXACT_TWO_DECLARATIONS_REQUIRED");
let count = 0;
statements.product_asset_declaration_valid =
  previous.product_asset_declaration_valid!.replace(
    /qf\.sha256_utf8\(qf\.consumer_canonical\(d\)\) IN \(([^)]+)\)/,
    (_, old) => {
      count++;
      return `qf.sha256_utf8(qf.consumer_canonical(d)) IN (${old},${added.map((r: unknown) => "'" + sha(canonical(r)) + "'").join(",")})`;
    },
  );
if (count !== 1) throw Error("ASSET_DECLARATION_INSERTION_MISSING");
const baselineIdentity = {
  kind: "baseline",
  id: baseline.id,
  version: baseline.version,
  entrySha256: sha(canonical(baseline)),
};
const newReview = `(a='${canonical(baseline.approval)}'::jsonb AND r.product_id='${R.productId}' AND r.canonical_content_sha256::text='${R.canonicalContentSha256}' AND r.asset_set_sha256::text='${R.assetSetSha256}' AND r.canonical_manifest_sha256::text='${R.canonicalManifestSha256}' AND b->'baseline'='${canonical(baselineIdentity)}'::jsonb)`;
statements.internal_review_valid = replaceOnce(
  previous.internal_review_valid!,
  "AND ((a=",
  `AND (${newReview} OR (a=`,
);
statements.protect_internal_reference = replaceOnce(
  previous.protect_internal_reference!,
  "AND qf.private_test_database_valid() IS NOT TRUE",
  "AND (qf.private_test_database_valid() IS NOT TRUE OR current_database() IS DISTINCT FROM 'qf_db_'||(NEW.facts_text::jsonb#>>'{approval,instanceId}'))",
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
const guard = (name: string, definition: string) => {
  const delim = name === "consumer_schema_v2" ? "$schema$" : "$$",
    body = definition.split(delim)[1]!;
  const stable = /LANGUAGE (?:sql|plpgsql) STABLE/.test(definition),
    immutable = /LANGUAGE (?:sql|plpgsql) IMMUTABLE/.test(definition),
    strict = /\bSTRICT\b/.test(definition.slice(0, definition.indexOf(delim)));
  const language = /LANGUAGE sql/.test(definition) ? "sql" : "plpgsql",
    returns =
      name === "consumer_schema_v2" || name === "composed_assets_v1"
        ? "jsonb"
        : name === "protect_internal_reference"
          ? "trigger"
          : "boolean";
  return `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='qf.${name}(${signatures[name]})'::regprocedure AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='${sha(body)}' AND provolatile='${immutable ? "i" : stable ? "s" : "v"}' AND proisstrict=${strict} AND NOT prosecdef AND NOT proretset AND NOT proleakproof AND prokind='f' AND pronargdefaults=0 AND prorettype='${returns}'::regtype AND prolang=(SELECT oid FROM pg_language WHERE lanname='${language}') AND proconfig=ARRAY['search_path=pg_catalog']) THEN RAISE EXCEPTION 'ROLE_COMPOSITE_HELPER_CHANGED:${name}'; END IF; END $$;\n`;
};
let sql =
  "-- Add the exact 3293 private source and optional fixed role-composite pair.\n-- Prior migrations and immutable snapshots remain unchanged.\n" +
  m26.slice(
    m26.indexOf("LOCK TABLE"),
    m26.indexOf("DO $$ BEGIN IF NOT EXISTS"),
  );
sql = sql.replace(
  "qf.draft_revision,qf.product_version",
  "qf.draft_revision,qf.draft_review,qf.product_version",
);
for (const n of names) sql += guard(n, previous[n]!);
sql += "\n" + names.map((n) => statements[n]).join("\n\n") + "\n";
for (const n of names) sql += guard(n, statements[n]!);
sql += `DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid IN (${names.map((n) => "'qf." + n + "(" + signatures[n] + ")'::regprocedure").join(",")}) AND a.grantee=0) THEN RAISE EXCEPTION 'ROLE_COMPOSITE_PUBLIC_EXECUTE'; END IF; END $$;\n`;
sql += `DO $$ DECLARE v qf.quizpack_validation; a qf.draft_review; p qf.product_version; play qf.internal_play_version; r qf.quiz_report; BEGIN FOR v IN SELECT * FROM qf.quizpack_validation LOOP IF qf.validation_shape_valid(v) IS NOT TRUE THEN RAISE EXCEPTION 'ROLE_COMPOSITE_EXISTING_VALIDATION'; END IF; END LOOP; FOR a IN SELECT * FROM qf.draft_review LOOP IF qf.internal_review_valid(a) IS NOT TRUE THEN RAISE EXCEPTION 'ROLE_COMPOSITE_EXISTING_REVIEW'; END IF; END LOOP; FOR p IN SELECT * FROM qf.product_version LOOP IF qf.internal_version_valid(p) IS NOT TRUE THEN RAISE EXCEPTION 'ROLE_COMPOSITE_EXISTING_VERSION'; END IF; END LOOP; FOR play IN SELECT * FROM qf.internal_play_version LOOP IF qf.consumer_play_valid(play) IS NOT TRUE THEN RAISE EXCEPTION 'ROLE_COMPOSITE_EXISTING_PLAY'; END IF; END LOOP; FOR r IN SELECT * FROM qf.quiz_report LOOP IF qf.consumer_report_valid(r) IS NOT TRUE THEN RAISE EXCEPTION 'ROLE_COMPOSITE_EXISTING_REPORT'; END IF; END LOOP; END $$;\n`;
await writeFile("migrations/p2a/0028_private_test_role_composite.sql", sql, {
  flag: "wx",
});
console.log(
  JSON.stringify({
    generated: true,
    bytes: Buffer.byteLength(sql),
    source: R.canonicalContentSha256,
    baseline: baselineIdentity,
    addedDeclarationHashes: added.map((r: unknown) => sha(canonical(r))),
  }),
);
