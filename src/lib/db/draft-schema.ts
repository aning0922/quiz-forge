import "server-only";
import type postgres from "postgres";
import { StudioUnavailableError } from "./runtime";
import { draftSchemaFacts } from "./draft-schema-facts";

/** Application-only capability check. Owners can still stage and finish migrations. */
export async function verifyDraftSchema(sql: postgres.Sql): Promise<void> {
  const tables = await sql<{ name: string; valid: boolean }[]>`
    SELECT c.relname AS name,
      (c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
       AND has_table_privilege(current_user,c.oid,'SELECT')
       AND has_table_privilege(current_user,c.oid,'INSERT')
       AND NOT has_table_privilege(current_user,c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
       AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0)
       AND NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=c.oid AND (NOT i.indisvalid OR NOT i.indisready OR NOT i.indislive))) AS valid
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='qf' AND c.relname IN ('product_draft','draft_revision','draft_application')`;
  if (tables.length !== 3 || tables.some((table) => table.valid !== true))
    throw new StudioUnavailableError();
  const columns = await sql<
    {
      table_name: string;
      column_name: string;
      column_type: string;
      required: boolean;
      allowed: boolean;
      default_expression: string | null;
    }[]
  >`
    SELECT c.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS column_type,a.attnotnull AS required,pg_get_expr(d.adbin,d.adrelid) AS default_expression,
      (has_column_privilege(current_user,c.oid,a.attnum,'SELECT')
       AND has_column_privilege(current_user,c.oid,a.attnum,'INSERT')
       AND has_column_privilege(current_user,c.oid,a.attnum,'UPDATE')=(c.relname='product_draft' AND a.attname='current_revision')
       AND NOT has_column_privilege(current_user,c.oid,a.attnum,'REFERENCES')
       AND NOT EXISTS(SELECT 1 FROM aclexplode(a.attacl) p WHERE p.grantee=0)) AS allowed
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='qf' AND c.relname IN ('product_draft','draft_revision','draft_application')
      AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`;
  if (
    columns.length !== draftSchemaFacts.columns.length ||
    draftSchemaFacts.columns.some((expected, index) => {
      const actual = columns[index];
      return (
        !actual ||
        actual.allowed !== true ||
        actual.table_name !== expected.table_name ||
        actual.column_name !== expected.column_name ||
        actual.column_type !== expected.column_type ||
        actual.required !== expected.required ||
        actual.default_expression !== expected.default_expression
      );
    })
  )
    throw new StudioUnavailableError();
  const constraints = await sql<
    {
      table_name: string;
      name: string;
      definition: string;
      kind: string;
      validated: boolean;
      enforced: boolean;
    }[]
  >`
    SELECT c.relname AS table_name,k.conname AS name,pg_get_constraintdef(k.oid) AS definition,k.contype AS kind,k.convalidated AS validated,
      (k.conenforced AND (k.contype<>'f' OR
        (SELECT count(*)=4 AND bool_and(t.tgisinternal AND t.tgenabled='O'
          AND t.tgqual IS NULL AND t.tgattr=''::int2vector AND t.tgnargs=0 AND octet_length(t.tgargs)=0)
         FROM pg_trigger t WHERE t.tgconstraint=k.oid))) AS enforced
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='qf' AND (c.relname IN ('product_draft','draft_revision','draft_application')
      OR(c.relname='quizpack_validation' AND k.conname='validation_product_import_id')
      OR(c.relname='audit_event' AND k.conname='audit_target')) ORDER BY c.relname,k.conname`;
  if (
    constraints.length !== draftSchemaFacts.constraints.length ||
    draftSchemaFacts.constraints.some((expected, index) => {
      const actual = constraints[index];
      return (
        !actual ||
        actual.validated !== true ||
        actual.enforced !== true ||
        actual.table_name !== expected.table_name ||
        actual.name !== expected.name ||
        actual.definition !== expected.definition ||
        actual.kind !== expected.kind
      );
    })
  )
    throw new StudioUnavailableError();
  const helpers = await sql<
    {
      signature: string;
      body_sha256: string;
      volatility: string;
      allowed: boolean;
    }[]
  >`
    SELECT p.oid::regprocedure::text AS signature,encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS body_sha256,p.provolatile AS volatility,
      (NOT p.prosecdef AND NOT p.proretset AND NOT p.proleakproof AND p.prokind='f' AND p.pronargdefaults=0
       AND p.proconfig=ARRAY['search_path=pg_catalog']
       AND ((p.proname IN ('draft_application_fingerprint','draft_revision_application_fingerprint') AND p.proisstrict AND p.prorettype='text'::regtype AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql'))
         OR(p.proname IN ('protect_draft_revision_source','protect_draft_progress','check_draft_closure') AND NOT p.proisstrict AND p.prorettype='trigger'::regtype AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')))
       AND has_function_privilege(current_user,p.oid,'EXECUTE')=(p.proname IN ('draft_application_fingerprint','draft_revision_application_fingerprint'))
       AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0)) AS allowed
    FROM pg_proc p WHERE p.pronamespace='qf'::regnamespace AND p.proname IN ('draft_application_fingerprint','draft_revision_application_fingerprint','protect_draft_revision_source','protect_draft_progress','check_draft_closure') ORDER BY signature`;
  if (
    helpers.length !== draftSchemaFacts.helpers.length ||
    draftSchemaFacts.helpers.some((expected, index) => {
      const actual = helpers[index];
      return (
        !actual ||
        actual.allowed !== true ||
        actual.signature !== expected.signature ||
        actual.body_sha256 !== expected.body_sha256 ||
        actual.volatility !== expected.volatility
      );
    })
  )
    throw new StudioUnavailableError();
  const triggers = await sql<
    { table_name: string; name: string; definition: string; valid: boolean }[]
  >`
    SELECT c.relname AS table_name,t.tgname AS name,pg_get_triggerdef(t.oid) AS definition,
      (t.tgenabled='O' AND t.tgqual IS NULL AND t.tgattr=''::int2vector AND t.tgnargs=0 AND octet_length(t.tgargs)=0 AND t.tgconstrrelid=0 AND t.tgparentid=0 AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL AND ((t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred) OR(t.tgconstraint<>0 AND t.tgdeferrable AND t.tginitdeferred))) AS valid
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE t.tgrelid IN ('qf.product_draft'::regclass,'qf.draft_revision'::regclass,'qf.draft_application'::regclass) AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`;
  if (
    triggers.length !== draftSchemaFacts.triggers.length ||
    draftSchemaFacts.triggers.some((expected, index) => {
      const actual = triggers[index];
      return (
        !actual ||
        !actual.valid ||
        actual.table_name !== expected.table_name ||
        actual.name !== expected.name ||
        actual.definition !== expected.definition
      );
    })
  )
    throw new StudioUnavailableError();
  const [audit] = await sql<
    { present: boolean }[]
  >`SELECT EXISTS(SELECT 1 FROM pg_enum WHERE enumtypid='qf.audit_action'::regtype AND enumlabel='draft_applied') AS present`;
  if (audit?.present !== true) throw new StudioUnavailableError();
}
