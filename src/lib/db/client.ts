import "server-only";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import {
  loadRuntimeConfig,
  runtimeConfigSchema,
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
): postgres.Sql {
  return postgres({
    host: connection.host,
    port: connection.port,
    database: connection.name,
    username: connection.user,
    password: connection.password,
    max: 5,
    connect_timeout: 3,
    idle_timeout: 10,
    onnotice: () => {},
    connection: {
      application_name: "quizforge-p2a",
      search_path: "pg_catalog",
    },
  });
}

export async function verifyDatabaseIdentity(
  sql: postgres.Sql,
  config: P2aRuntimeConfig,
  role = config.database.user,
): Promise<void> {
  const [fact] =
    await sql`SELECT current_database() AS database, current_user AS role,
    current_setting('server_version_num')::int AS version,
    inet_server_addr()::text AS address, inet_server_port() AS port,
    shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()), 'pg_database') AS marker`;
  if (
    !fact ||
    fact.database !== config.database.name ||
    fact.role !== role ||
    fact.version !== config.server.version ||
    fact.address !== config.server.address ||
    fact.port !== config.server.port ||
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
    config = runtimeConfigSchema.parse(config);
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
