import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const hash = (s: string) =>
  createHash("sha256").update(s, "utf8").digest("hex");
/** Offline maintainer generator. Only adds one optional typed ref to the frozen SQL schemas. */
export function preferenceMigration(source: string) {
  const schema = source.match(
    /CREATE FUNCTION qf\.consumer_schema_v2\(kind text\)[\s\S]*?\$schema\$;/,
  )?.[0];
  const assets = source.match(
    /CREATE FUNCTION qf\.composed_assets_v1\(source jsonb,chosen_character jsonb\)[\s\S]*?END \$\$;/,
  )?.[0];
  if (!schema || !assets) throw Error("D3_PREVIOUS_FUNCTION_REQUIRED");
  let additions = 0;
  const expanded = schema.replace(
    /\$qztx_schema\$([^]*?)\$qztx_schema\$/g,
    (_, json: string) => {
      const value = JSON.parse(json);
      const visit = (node: unknown) => {
        if (!node || typeof node !== "object") return;
        const record = node as Record<string, unknown>;
        const props = record.properties as Record<string, unknown> | undefined;
        if (
          props &&
          ["cover", "acts", "reportPaper", "reportBorder", "seal"].every((k) =>
            Object.hasOwn(props, k),
          )
        ) {
          if (Object.hasOwn(props, "preferenceScene"))
            throw Error("D3_SLOT_ALREADY_PRESENT");
          props.preferenceScene = structuredClone(props.cover);
          additions++;
        }
        for (const child of Object.values(record)) visit(child);
      };
      visit(value);
      return "$qztx_schema$" + JSON.stringify(value) + "$qztx_schema$";
    },
  );
  if (additions !== 2) throw Error("D3_SCHEMA_SLOT_COUNT_CHANGED");
  const schemaBody = schema.split("$schema$")[1]!;
  const assetBody = assets.split("$$")[1]!;
  const insert = " SELECT refs||coalesce(jsonb_agg(ref),'[]') INTO refs";
  if (!assets.includes(insert)) throw Error("D3_ASSET_FUNCTION_CHANGED");
  const expandedAssets = assets.replace(
    insert,
    " IF neutral ? 'preferenceScene' THEN refs:=refs||jsonb_build_array(neutral->'preferenceScene'); END IF;\n" +
      insert,
  );
  const guard = source
    .slice(
      source.indexOf("LOCK TABLE"),
      source.indexOf("\n\n\nCREATE OR REPLACE FUNCTION"),
    )
    .replaceAll("D2_WRITERS_PRESENT", "D3_WRITERS_PRESENT")
    .replaceAll("D2_UNSETTLED_IO", "D3_UNSETTLED_IO");
  if (!guard.includes("D3_UNSETTLED_IO")) throw Error("D3_QUIESCENCE_REQUIRED");
  return `-- Additive optional preference scene. No content, snapshot, receipt or history rows are rewritten.
-- Stop writers and settle IO before applying. Existing function ACLs are preserved by OR REPLACE.
${guard}
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='qf.consumer_schema_v2(text)'::regprocedure AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='${hash(schemaBody)}' AND provolatile='i' AND proisstrict AND NOT prosecdef AND NOT proretset AND NOT proleakproof AND prokind='f' AND pronargdefaults=0 AND prorettype='jsonb'::regtype AND prolang=(SELECT oid FROM pg_language WHERE lanname='sql') AND proconfig=ARRAY['search_path=pg_catalog'])
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='qf.composed_assets_v1(jsonb,jsonb)'::regprocedure AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='${hash(assetBody)}' AND provolatile='i' AND proisstrict AND NOT prosecdef AND NOT proretset AND NOT proleakproof AND prokind='f' AND pronargdefaults=0 AND prorettype='jsonb'::regtype AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND proconfig=ARRAY['search_path=pg_catalog'])
 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid IN ('qf.consumer_schema_v2(text)'::regprocedure,'qf.composed_assets_v1(jsonb,jsonb)'::regprocedure) AND a.grantee=0)
 THEN RAISE EXCEPTION 'D3_PREVIOUS_HELPER_CHANGED' USING ERRCODE='55000'; END IF;
END $$;

${expanded.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")}

${expandedAssets.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION")}

-- Retain validation of historical rows under the extended, still strict schemas.
DO $$ DECLARE p qf.product_version; play qf.internal_play_version; r qf.quiz_report; BEGIN
 FOR p IN SELECT * FROM qf.product_version LOOP IF qf.internal_version_valid(p) IS NOT TRUE THEN RAISE EXCEPTION 'D3_EXISTING_VERSION' USING ERRCODE='23514'; END IF; END LOOP;
 FOR play IN SELECT * FROM qf.internal_play_version LOOP IF qf.consumer_play_valid(play) IS NOT TRUE THEN RAISE EXCEPTION 'D3_EXISTING_PLAY' USING ERRCODE='23514'; END IF; END LOOP;
 FOR r IN SELECT * FROM qf.quiz_report LOOP IF qf.consumer_report_valid(r) IS NOT TRUE THEN RAISE EXCEPTION 'D3_EXISTING_REPORT' USING ERRCODE='23514'; END IF; END LOOP;
END $$;
`;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--out")
    throw Error("EXPLICIT_NEW_OUTPUT_REQUIRED");
  const output = resolve(args[1]!);
  if (!output.startsWith(resolve(process.cwd()) + "/"))
    throw Error("WORKTREE_OUTPUT_REQUIRED");
  const sql = preferenceMigration(
    await readFile(
      "migrations/p2a/0024_matching_context_composed_reports.sql",
      "utf8",
    ),
  );
  await writeFile(output, sql, { flag: "wx" });
}
