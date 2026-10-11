import "server-only";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import {
  loadRuntimeConfig,
  normalizeRuntimeConfig,
  runtimeConfigFile,
  StudioUnavailableError,
  type P2aRuntimeConfig,
} from "./runtime";

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
  }
}

export async function createDatabase(
  config: P2aRuntimeConfig,
): Promise<P2aDatabase> {
  let sql: postgres.Sql | undefined;
  try {
    config = normalizeRuntimeConfig(runtimeConfigFile(config));
    sql = openSql(config.database);
    await verifyDatabaseIdentity(sql, config);
    const client = sql;
    return {
      sql,
      db: drizzle(sql, { schema }),
      config,
      close: () => client.end({ timeout: 3 }),
    };
  } catch {
    await sql?.end({ timeout: 1 }).catch(() => {});
    throw new StudioUnavailableError();
  }
}

// Caller owns this connection and must close it in finally; no global connection at import/build time.
export async function getDatabase(): Promise<P2aDatabase> {
  return createDatabase(await loadRuntimeConfig());
}
