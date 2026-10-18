import "server-only";
import postgres from "postgres";
import { StudioError } from "@/lib/http-security/errors";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { validationAckFunctionHashes } from "./validation-ack-schema";
import { verifyDraftSchema } from "./draft-schema";
import { verifyInternalVersionSchema } from "./internal-version-schema";
import { verifyConsumerSchema } from "./consumer-schema";
import {
  loadRuntimeConfig,
  normalizeRuntimeConfig,
  runtimeConfigFile,
  StudioUnavailableError,
  type P2aRuntimeConfig,
} from "./runtime";

/** Optional absolute operation budget; no feature dependency in the DB runtime. */
export type DatabaseBudget = {
  signal: AbortSignal;
  deadlineMonotonicMs: number;
};
export type P2aDatabase = {
  sql: postgres.Sql;
  db: PostgresJsDatabase<typeof schema>;
  config: P2aRuntimeConfig;
  close: () => Promise<void>;
};
export function openSql(
  connection: P2aRuntimeConfig["database"],
  max: 1 | 5 = 5,
): postgres.Sql {
  // postgres3.4.9 reads PG<OPTION> for every omitted default. Pin its entire default table.
  // sslnegotiation/max_pipeline exist in its runtime but are omitted by its shipped TS declarations.
  const options: postgres.Options<Record<string, postgres.PostgresType>> & {
    sslnegotiation: null;
    max_pipeline: number;
  } = {
    host: connection.host,
    port: connection.port,
    database: connection.name,
    username: connection.user,
    password: connection.password,
    ssl: false,
    sslnegotiation: null,
    debug: false,
    max,
    max_pipeline: 100,
    max_lifetime: 1800,
    backoff: false,
    keep_alive: 60,
    prepare: true,
    fetch_types: true,
    publications: "alltables",
    target_session_attrs: "read-write",
    connect_timeout: 3,
    idle_timeout: 10,
    onnotice: () => {},
    connection: {
      application_name: "quizforge-p2a",
      search_path: "pg_catalog",
    },
  };
  return postgres(options);
}

export async function verifyDatabaseIdentity(
  sql: postgres.Sql,
  config: P2aRuntimeConfig,
  role = config.database.user,
): Promise<void> {
  const [fact] =
    await sql`SELECT current_database() AS database, current_user AS role,
    current_setting('server_version_num')::int AS version,
    host(inet_server_addr()) AS address, inet_server_port() AS port,
    current_setting('listen_addresses') AS listen,
    shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()), 'pg_database') AS marker`;
  if (
    !fact ||
    fact.database !== config.database.name ||
    fact.role !== role ||
    fact.version !== config.server.version ||
    fact.address !== config.server.address ||
    fact.port !== config.server.port ||
    (config.purpose !== "ci" && fact.listen !== "127.0.0.1") ||
    fact.marker !== `quizforge.p2a.v1:${config.instanceId}:${config.purpose}`
  )
    throw new StudioUnavailableError();
  if (role === config.database.user) {
    const [privilege] =
      await sql`SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolinherit,
      EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS memberships,
      (SELECT datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user) FROM pg_database WHERE datname=current_database()) AS owner
      FROM pg_roles WHERE rolname=current_user`;
    if (!privilege || Object.values(privilege).some((v) => v !== false))
      throw new StudioUnavailableError();
    await verifyValidationSchema(sql);
    await verifyDraftSchema(sql);
    await verifyInternalVersionSchema(sql);
    await verifyConsumerSchema(sql);
  }
}

const validationSchemaColumns: Readonly<
  Record<string, readonly (readonly [string, string, boolean])[]>
> = {
  quizpack_validation: [
    ["id", "uuid", true],
    ["product_id", "character varying(80)", true],
    ["import_id", "uuid", true],
    ["created_by", "uuid", true],
    ["created_at", "timestamp with time zone", true],
    ["validation_key", "character(64)", true],
    ["archive_sha256", "character(64)", true],
    ["archive_bytes", "integer", true],
    ["identity_text", "text", true],
    ["identity_sha256", "character(64)", true],
    ["archive_policy_version", "character varying(64)", true],
    ["archive_policy_sha256", "character(64)", true],
    ["status", "text", true],
    ["state_revision", "integer", true],
    ["updated_at", "timestamp with time zone", true],
    ["fence", "integer", true],
    ["lease_until", "timestamp with time zone", false],
    ["current_attempt_id", "uuid", true],
    ["attempts_text", "text", true],
    ["storage_condition", "text", true],
    ["last_error_code", "character varying(64)", false],
    ["reserved_bytes", "bigint", true],
    ["accounted_bytes", "bigint", true],
    ["evidence_text", "text", false],
    ["evidence_sha256", "character(64)", false],
    ["report_texts", "text[]", true],
    ["evidence_metadata_text", "text", false],
    ["pack_id", "character varying(80)", false],
    ["pack_version", "character varying(32)", false],
    ["container_schema_version", "character varying(64)", false],
    ["content_schema_version", "character varying(64)", false],
    ["content_kind", "character varying(32)", false],
    ["manifest_sha256", "character(64)", false],
    ["content_sha256", "character(64)", false],
    ["canonical_manifest_text", "text", false],
    ["canonical_manifest_sha256", "character(64)", false],
    ["canonical_content_text", "text", false],
    ["canonical_content_sha256", "character(64)", false],
    ["asset_set_text", "text", false],
    ["asset_set_sha256", "character(64)", false],
    ["candidate_sha256", "character(64)", false],
    ["resource_count", "smallint", false],
    ["identity_kind", "text", true],
    ["canonical_validation_id", "uuid", false],
    ["validated_at", "timestamp with time zone", false],
    ["ready_at", "timestamp with time zone", false],
  ],
  asset_blob: [
    ["sha256", "character(64)", true],
    ["bytes", "integer", true],
    ["media_type", "character varying(32)", true],
    ["width", "integer", true],
    ["height", "integer", true],
    ["frames", "smallint", true],
    ["storage_key", "character varying(96)", true],
    ["created_at", "timestamp with time zone", true],
  ],
  product_asset: [
    ["product_id", "character varying(80)", true],
    ["resource_id", "character varying(80)", true],
    ["resource_version", "character varying(32)", true],
    ["blob_sha256", "character(64)", true],
    ["declaration_text", "text", true],
    ["declaration_sha256", "character(64)", true],
    ["purpose", "character varying(16)", true],
    ["source_validation_id", "uuid", true],
    ["platform_approval", "character varying(16)", true],
    ["created_at", "timestamp with time zone", true],
  ],
};
const validationMutableColumns = new Set([
  "status",
  "state_revision",
  "updated_at",
  "fence",
  "lease_until",
  "current_attempt_id",
  "attempts_text",
  "storage_condition",
  "last_error_code",
  "reserved_bytes",
  "accounted_bytes",
  "evidence_text",
  "evidence_sha256",
  "report_texts",
  "evidence_metadata_text",
  "pack_id",
  "pack_version",
  "container_schema_version",
  "content_schema_version",
  "content_kind",
  "manifest_sha256",
  "content_sha256",
  "canonical_manifest_text",
  "canonical_manifest_sha256",
  "canonical_content_text",
  "canonical_content_sha256",
  "asset_set_text",
  "asset_set_sha256",
  "candidate_sha256",
  "resource_count",
  "identity_kind",
  "canonical_validation_id",
  "validated_at",
  "ready_at",
]);
const validationHelpers: Readonly<Record<string, boolean>> = {
  "qf.sha256_utf8(text)": true,
  "qf.validation_attempts_valid(text,integer,uuid,bigint)": true,
  "qf.validation_evidence_valid(text,text[],text,text)": true,
  "qf.product_asset_declaration_valid(text,text,text,text,text,text)": true,
  "qf.validation_shape_valid(qf.quizpack_validation)": true,
  "qf.protect_validation()": false,
  "qf.protect_product_asset()": false,
  "qf.validation_ready_assets()": false,
  "qf.product_asset_ready_source()": false,
  "qf.validation_file_stop_protocol()": true,
  "qf.validation_file_stop_proof_valid(jsonb,uuid,jsonb)": true,
  "qf.validation_file_stop_controls_valid(text,uuid,text,text)": true,
  "qf.protect_validation_file_stop_ack()": false,
};
/** App-only fail-closed B schema/privilege check. Owner remains able to migrate old instances. */
async function verifyValidationSchema(sql: postgres.Sql): Promise<void> {
  const tables = await sql<
    {
      table_name: string;
      kind: string;
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
      can_truncate: boolean;
      can_references: boolean;
      can_trigger: boolean;
      schema_create: boolean;
    }[]
  >`
    SELECT c.relname AS table_name,c.relkind AS kind,
      has_table_privilege(current_user,c.oid,'SELECT') AS can_select,
      has_table_privilege(current_user,c.oid,'INSERT') AS can_insert,
      has_table_privilege(current_user,c.oid,'UPDATE') AS can_update,
      has_table_privilege(current_user,c.oid,'DELETE') AS can_delete,
      has_table_privilege(current_user,c.oid,'TRUNCATE') AS can_truncate,
      has_table_privilege(current_user,c.oid,'REFERENCES') AS can_references,
      has_table_privilege(current_user,c.oid,'TRIGGER') AS can_trigger,
      has_schema_privilege(current_user,n.oid,'CREATE') AS schema_create
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='qf' AND c.relname IN ('quizpack_validation','asset_blob','product_asset') ORDER BY c.relname`;
  if (
    tables.length !== 3 ||
    tables.some(
      (t) =>
        t.kind !== "r" ||
        !t.can_select ||
        !t.can_insert ||
        t.can_update ||
        t.can_delete ||
        t.can_truncate ||
        t.can_references ||
        t.can_trigger ||
        t.schema_create,
    )
  )
    throw new StudioUnavailableError();
  const columns = await sql<
    {
      table_name: string;
      column_name: string;
      column_type: string;
      required: boolean;
      can_update: boolean;
    }[]
  >`
    SELECT c.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS column_type,a.attnotnull AS required,
      has_column_privilege(current_user,c.oid,a.attnum,'UPDATE') AS can_update
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='qf' AND c.relname IN ('quizpack_validation','asset_blob','product_asset') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`;
  for (const [table, expected] of Object.entries(validationSchemaColumns)) {
    const actual = columns.filter((c) => c.table_name === table);
    if (
      actual.length !== expected.length ||
      expected.some(([name, type, required]) => {
        const c = actual.find((c) => c.column_name === name);
        return (
          !c ||
          c.column_type !== type ||
          c.required !== required ||
          c.can_update !==
            (table === "quizpack_validation" &&
              validationMutableColumns.has(name))
        );
      })
    )
      throw new StudioUnavailableError();
  }
  const helpers = await sql<
    {
      signature: string;
      present: boolean;
      can_execute: boolean;
      security_definer: boolean;
      fixed_path: boolean;
      body_sha256: string | null;
      admission_attributes: boolean;
    }[]
  >`
    SELECT s.signature,p.oid IS NOT NULL AS present,
      CASE WHEN p.oid IS NULL THEN false ELSE has_function_privilege(current_user,p.oid,'EXECUTE') END AS can_execute,
      coalesce(p.prosecdef,true) AS security_definer,
      CASE WHEN p.oid IS NULL THEN NULL ELSE encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') END AS body_sha256,
      coalesce(p.proconfig=ARRAY['search_path=pg_catalog'],false) AS fixed_path,
      CASE WHEN p.proname IN ('validation_shape_valid','sha256_utf8') THEN
        (NOT p.proretset AND NOT p.proleakproof AND p.prokind='f' AND p.pronargdefaults=0
          AND ((p.proname='validation_shape_valid' AND p.provolatile='s' AND NOT p.proisstrict AND p.prorettype='boolean'::regtype AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql'))
            OR(p.proname='sha256_utf8' AND p.provolatile='i' AND p.proisstrict AND p.prorettype='text'::regtype AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='sql'))))
        ELSE true END AS admission_attributes
    FROM unnest(${sql.array(Object.keys(validationHelpers))}::text[]) AS s(signature)
    LEFT JOIN pg_proc p ON p.oid=to_regprocedure(s.signature)`;
  if (
    helpers.length !== Object.keys(validationHelpers).length ||
    helpers.some(
      (f) =>
        !f.present ||
        f.can_execute !== validationHelpers[f.signature] ||
        f.security_definer ||
        !f.fixed_path ||
        f.admission_attributes !== true ||
        (validationAckFunctionHashes[f.signature] !== undefined &&
          validationAckFunctionHashes[f.signature] !== f.body_sha256),
    )
  )
    throw new StudioUnavailableError();
  const [protocol] = await sql<
    { version: string; audit: boolean; controls: boolean; triggers: boolean }[]
  >`
    SELECT qf.validation_file_stop_protocol() AS version,
      EXISTS(SELECT 1 FROM pg_enum WHERE enumtypid='qf.audit_action'::regtype AND enumlabel='validation_file_stop_acknowledged') AS audit,
      EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='qf.quizpack_validation'::regclass AND conname='validation_file_stop_controls' AND contype='c' AND convalidated
        AND pg_get_constraintdef(oid)='CHECK (qf.validation_file_stop_controls_valid((archive_policy_version)::text, id, attempts_text, evidence_metadata_text))') AS controls,
      (SELECT count(*)=2 FROM pg_trigger WHERE tgrelid='qf.quizpack_validation'::regclass AND NOT tgisinternal AND tgenabled='O' AND tgtype=23
        AND tgqual IS NULL AND tgattr=''::int2vector AND tgnargs=0 AND octet_length(tgargs)=0
        AND tgconstraint=0 AND tgconstrrelid=0 AND NOT tgdeferrable AND NOT tginitdeferred AND tgparentid=0
        AND tgoldtable IS NULL AND tgnewtable IS NULL
        AND ((tgname='protect_validation' AND tgfoid='qf.protect_validation()'::regprocedure)
          OR (tgname='protect_validation_file_stop_ack' AND tgfoid='qf.protect_validation_file_stop_ack()'::regprocedure))) AS triggers`;
  if (
    protocol?.version !== "candidate-receipt-db-ack.v1" ||
    !protocol.audit ||
    !protocol.controls ||
    !protocol.triggers
  )
    throw new StudioUnavailableError();
}

export async function createDatabase(
  config: P2aRuntimeConfig,
  budget?: DatabaseBudget,
): Promise<P2aDatabase> {
  let sql: postgres.Sql | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expire: (() => void) | undefined;
  let expired = false;
  const dispose = () => {
    clearTimeout(timer);
    if (expire && budget) budget.signal.removeEventListener("abort", expire);
  };
  try {
    config = normalizeRuntimeConfig(runtimeConfigFile(config));
    if (
      budget &&
      (budget.signal.aborted ||
        !Number.isFinite(budget.deadlineMonotonicMs) ||
        budget.deadlineMonotonicMs <= performance.now())
    )
      throw new StudioError("RECEIVE_TIMEOUT");
    sql = openSql(config.database);
    const client = sql;
    // Budget cancellation may force-close independently of the handler. Keep that
    // real promise observable by the caller's idempotent close as well.
    const endings: Promise<void>[] = [];
    let closing: Promise<void> | undefined;
    const end = (timeout: number) => {
      const pending = client.end({ timeout });
      endings.push(pending);
      void pending.catch(() => {});
      return pending;
    };
    const verification = verifyDatabaseIdentity(client, config);
    if (budget) {
      const expiration = new Promise<never>((_, reject) => {
        expire = () => {
          expired = true;
          void end(0);
          reject(new StudioError("RECEIVE_TIMEOUT"));
        };
        budget.signal.addEventListener("abort", expire, { once: true });
        timer = setTimeout(
          expire,
          Math.max(0, budget.deadlineMonotonicMs - performance.now()),
        );
        timer.unref?.();
        if (budget.signal.aborted) expire();
      });
      await Promise.race([verification, expiration]);
    } else await verification;
    return {
      sql,
      db: drizzle(sql, { schema }),
      config,
      close: () => {
        if (closing) return closing;
        dispose();
        void end(expired ? 0 : 3);
        closing = Promise.allSettled(endings).then((results) => {
          const failed = results.find((result) => result.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
        });
        return closing;
      },
    };
  } catch (error) {
    dispose();
    await sql?.end({ timeout: budget ? 0 : 1 }).catch(() => {});
    if (expired || error instanceof StudioError)
      throw new StudioError("RECEIVE_TIMEOUT");
    throw new StudioUnavailableError();
  }
}

// Caller owns this connection and must close it in finally; no global connection at import/build time.
export async function getDatabase(
  budget?: DatabaseBudget,
): Promise<P2aDatabase> {
  return createDatabase(await loadRuntimeConfig(), budget);
}
