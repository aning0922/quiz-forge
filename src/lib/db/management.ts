import "server-only";
import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import postgres from "postgres";
import { z } from "zod";
import { runPg, type PgCommandRunner } from "./pg-command";
import {
  assertLocalPgdata,
  readPostmaster,
  startPostgres,
  stopStartedPostgres,
  PgStartError,
  type LocalPgIdentity,
  type StartedPostgres,
} from "./pg-start";
import { openSql, verifyDatabaseIdentity } from "./client";
import { migrateDatabase } from "./migrate";
import {
  isLocalOrigin,
  readPrivateJson,
  normalizeRuntimeConfig,
  runtimeConfigFile,
  type P2aRuntimeConfig,
} from "./runtime";

const idSchema = z.string().regex(/^[a-f0-9]{32}$/);
const connectionSchema = z.strictObject({
  host: z.literal("127.0.0.1"),
  port: z
    .number()
    .int()
    .min(1024)
    .max(65535)
    .refine((p) => p !== 5432),
  name: z.string(),
  user: z.string(),
  password: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
const adminSchema = z.strictObject({
  version: z.literal(1),
  instanceId: idSchema,
  owner: connectionSchema,
});
const manifestSchema = z.strictObject({
  version: z.literal(1),
  instanceId: idSchema,
  purpose: z.enum(["test", "demo", "ci"]),
  mode: z.enum(["local", "ci"]),
  origin: z.string().refine(isLocalOrigin),
  root: z.string(),
  port: z.number().int(),
  pgdata: z.string().nullable(),
  socket: z.string().nullable(),
  runtimeConfigPath: z.string(),
  adminConfigPath: z.string(),
});
export type P2aManifest = z.infer<typeof manifestSchema>;
export type P2aAdminConfig = z.infer<typeof adminSchema>;
export class ManagementError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
function fail(code: string): never {
  throw new ManagementError(code);
}
const privateRoot = (root = process.cwd()) => path.join(root, ".cache", "p2a");
export function instancePaths(instanceId: string, root = process.cwd()) {
  idSchema.parse(instanceId);
  const directory = path.join(privateRoot(root), instanceId);
  return {
    directory,
    manifest: path.join(directory, "manifest.json"),
    runtime: path.join(directory, "runtime.json"),
    admin: path.join(directory, "admin.json"),
    pgdata: path.join(directory, "pgdata"),
    socket: path.join(directory, "socket"),
  };
}
export async function writePrivateJson(
  file: string,
  data: unknown,
): Promise<void> {
  await writeFile(file, JSON.stringify(data, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}
async function newInstanceDirectory(recoveryInstanceId?: string) {
  const base = privateRoot();
  await mkdir(base, { recursive: true, mode: 0o700 });
  const stat = await lstat(base);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o700 ||
    stat.uid !== process.getuid?.() ||
    (await realpath(base)) !== base
  )
    fail("PRIVATE_DIRECTORY_INVALID");
  const instanceId = recoveryInstanceId ?? randomBytes(16).toString("hex");
  idSchema.parse(instanceId);
  const paths = instancePaths(instanceId);
  await mkdir(paths.directory, { mode: 0o700 });
  return { instanceId, paths };
}
export async function loadManagedInstance(instanceId: string): Promise<{
  manifest: P2aManifest;
  config: P2aRuntimeConfig;
  admin: P2aAdminConfig;
}> {
  try {
    const paths = instancePaths(instanceId);
    const manifest = manifestSchema.parse(
      await readPrivateJson(paths.manifest),
    );
    const config = normalizeRuntimeConfig(await readPrivateJson(paths.runtime));
    const admin = adminSchema.parse(await readPrivateJson(paths.admin));
    if (
      manifest.instanceId !== instanceId ||
      config.instanceId !== instanceId ||
      admin.instanceId !== instanceId ||
      manifest.root !== process.cwd() ||
      manifest.runtimeConfigPath !== paths.runtime ||
      manifest.adminConfigPath !== paths.admin ||
      manifest.port !== config.database.port ||
      manifest.origin !== config.origin ||
      manifest.purpose !== config.purpose ||
      admin.owner.name !== config.database.name ||
      admin.owner.host !== config.database.host ||
      admin.owner.port !== config.database.port ||
      admin.owner.user !== `qf_owner_${instanceId}` ||
      (manifest.mode === "local" &&
        (manifest.purpose === "ci" ||
          manifest.pgdata !== paths.pgdata ||
          manifest.socket !== paths.socket)) ||
      (manifest.mode === "ci" &&
        (manifest.purpose !== "ci" ||
          manifest.pgdata !== null ||
          manifest.socket !== null))
    )
      fail("INSTANCE_IDENTITY_INVALID");
    return { manifest, config, admin };
  } catch {
    return fail("INSTANCE_IDENTITY_INVALID");
  }
}
export async function openManagedDatabase(instanceId: string) {
  const managed = await loadManagedInstance(instanceId);
  const sql = openSql(managed.admin.owner);
  try {
    await verifyDatabaseIdentity(sql, managed.config, managed.admin.owner.user);
  } catch {
    await sql.end({ timeout: 1 });
    fail("INSTANCE_DATABASE_MISMATCH");
  }
  return { ...managed, sql, close: () => sql.end({ timeout: 3 }) };
}
async function checkPort(port: number) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 5432)
    fail("PORT_INVALID");
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new ManagementError("PORT_UNAVAILABLE")));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () =>
      server.close((error) =>
        error ? reject(new ManagementError("PORT_UNAVAILABLE")) : resolve(),
      ),
    );
  });
}
function localIdentity(manifest: P2aManifest): LocalPgIdentity {
  if (manifest.mode !== "local" || !manifest.pgdata || !manifest.socket)
    fail("LOCAL_INSTANCE_REQUIRED");
  return {
    instanceId: manifest.instanceId,
    pgdata: manifest.pgdata,
    socket: manifest.socket,
    port: manifest.port,
  };
}
async function assertPgdata(manifest: P2aManifest) {
  await assertLocalPgdata(localIdentity(manifest));
}
async function verifyRunningPgdata(manifest: P2aManifest) {
  await readPostmaster(localIdentity(manifest));
}

async function provision(
  sql: postgres.Sql,
  instanceId: string,
  purpose: P2aRuntimeConfig["purpose"],
  ownerPassword: string,
  appPassword: string,
) {
  const owner = `qf_owner_${instanceId}`,
    app = `qf_app_${instanceId}`,
    database = `qf_db_${instanceId}`;
  await sql.unsafe("SET log_min_error_statement = 'panic'");
  await sql.unsafe("SET log_parameter_max_length_on_error = 0");
  // Identifiers and passwords are generated/validated, never user SQL or a DSN.
  await sql.unsafe(
    `CREATE ROLE "${owner}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${ownerPassword}'`,
  );
  await sql.unsafe(
    `CREATE ROLE "${app}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${appPassword}'`,
  );
  await sql`CREATE DATABASE ${sql(database)} OWNER ${sql(owner)}`;
  await sql.unsafe(
    `COMMENT ON DATABASE "${database}" IS 'quizforge.p2a.v1:${instanceId}:${purpose}'`,
  );
  await sql`REVOKE ALL ON DATABASE ${sql(database)} FROM PUBLIC`;
  await sql`GRANT CONNECT ON DATABASE ${sql(database)} TO ${sql(app)}`;
}

export async function initLocalInstance(
  options: {
    port: number;
    origin: string;
    purpose: "test" | "demo";
  },
  commands: PgCommandRunner = runPg,
) {
  return initializeLocalInstance(options, commands);
}

/** Internal recovery bootstrap: new physical cluster, same logical names, no schema migration. */
export async function initEmptyRecoveryInstance(
  options: {
    instanceId: string;
    port: number;
    origin: string;
    purpose: "test" | "demo";
  },
  commands: PgCommandRunner,
) {
  idSchema.parse(options.instanceId);
  return initializeLocalInstance(options, commands, options.instanceId);
}

async function initializeLocalInstance(
  options: { port: number; origin: string; purpose: "test" | "demo" },
  commands: PgCommandRunner,
  recoveryInstanceId?: string,
) {
  if (
    !isLocalOrigin(options.origin) ||
    !["test", "demo"].includes(options.purpose)
  )
    fail("INIT_ARGUMENTS_INVALID");
  if (
    !(await commands("postgres", ["--version"])).includes(" 18.4 ") ||
    !(await commands("initdb", ["--version"])).includes(" 18.4 ")
  )
    fail("PG_VERSION_INVALID");
  await checkPort(options.port);
  const { instanceId, paths } = await newInstanceDirectory(recoveryInstanceId);
  if (recoveryInstanceId)
    await writePrivateJson(
      path.join(paths.directory, "recovery-pending.json"),
      {
        version: 1,
        instanceId,
        status: "unverified",
      },
    );
  const password = randomBytes(32).toString("base64url"),
    ownerPassword = randomBytes(32).toString("base64url"),
    appPassword = randomBytes(32).toString("base64url");
  const clusterRole = `qf_cluster_${instanceId}`;
  const passwordFile = path.join(paths.directory, "init-password");
  let started: StartedPostgres | undefined;
  try {
    await writeFile(passwordFile, password + "\n", { flag: "wx", mode: 0o600 });
    await commands("initdb", [
      "-D",
      paths.pgdata,
      "-U",
      clusterRole,
      "--auth-local=scram-sha-256",
      "--auth-host=scram-sha-256",
      `--pwfile=${passwordFile}`,
      "--encoding=UTF8",
      "--locale=C",
    ]);
    await unlink(passwordFile);
    await mkdir(paths.socket, { mode: 0o700 });
    await writeFile(
      path.join(paths.pgdata, "postgresql.conf"),
      `\n# quizforge.p2a:${instanceId}\nlisten_addresses = '127.0.0.1'\nport = ${options.port}\nunix_socket_directories = '../socket'\npassword_encryption = 'scram-sha-256'\nlog_min_error_statement = 'panic'\nlog_parameter_max_length_on_error = 0\n${recoveryInstanceId ? "log_error_verbosity = 'terse'\n" : ""}`,
      { flag: "a" },
    );
    // Keep only loopback/socket access; no LAN addresses or trust auth.
    await writeFile(
      path.join(paths.pgdata, "pg_hba.conf"),
      "local all all scram-sha-256\nhost all all 127.0.0.1/32 scram-sha-256\n",
      { mode: 0o600 },
    );
    await chmod(path.join(paths.pgdata, "pg_hba.conf"), 0o600);
    const log = path.join(paths.directory, "server.log");
    await writeFile(log, "", { flag: "wx", mode: 0o600 });
    started = await startPostgres(
      {
        instanceId,
        pgdata: paths.pgdata,
        socket: paths.socket,
        port: options.port,
      },
      commands,
    );
    const cluster = openSql({
      host: "127.0.0.1",
      port: options.port,
      name: "postgres",
      user: clusterRole,
      password,
    });
    try {
      await provision(
        cluster,
        instanceId,
        options.purpose,
        ownerPassword,
        appPassword,
      );
    } finally {
      await cluster.end({ timeout: 3 });
    }
    const config = normalizeRuntimeConfig({
      version: 2,
      imports: { enabled: false },
      profile: "local-http-p2a",
      purpose: options.purpose,
      origin: options.origin,
      instanceId,
      database: {
        host: "127.0.0.1",
        port: options.port,
        name: `qf_db_${instanceId}`,
        user: `qf_app_${instanceId}`,
        password: appPassword,
      },
      server: { version: 180004, address: "127.0.0.1", port: options.port },
    });
    const admin: P2aAdminConfig = {
      version: 1,
      instanceId,
      owner: {
        ...config.database,
        user: `qf_owner_${instanceId}`,
        password: ownerPassword,
      },
    };
    const manifest: P2aManifest = {
      version: 1,
      instanceId,
      purpose: options.purpose,
      mode: "local",
      origin: options.origin,
      root: process.cwd(),
      port: options.port,
      pgdata: paths.pgdata,
      socket: paths.socket,
      runtimeConfigPath: paths.runtime,
      adminConfigPath: paths.admin,
    };
    await writePrivateJson(paths.runtime, runtimeConfigFile(config));
    await writePrivateJson(paths.admin, admin);
    await writePrivateJson(paths.manifest, manifest);
    const db = await openManagedDatabase(instanceId);
    try {
      if (!recoveryInstanceId) await migrateDatabase(db.sql, config);
    } finally {
      await db.close();
    }
    return manifest;
  } catch (error) {
    // Never delete the new instance; preserve partial state for inspection. Only stop our just-started PGDATA.
    let cleanupFailed =
      error instanceof PgStartError &&
      error.code === "START_FAILED_CLEANUP_REQUIRED";
    if (started && !(await stopStartedPostgres(started, commands)))
      cleanupFailed = true;
    try {
      await unlink(passwordFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        cleanupFailed = true;
    }
    return fail(
      cleanupFailed
        ? "INIT_FAILED_CLEANUP_REQUIRED"
        : "INIT_FAILED_INSTANCE_PRESERVED",
    );
  }
}

export async function manageLocalInstance(
  command: "start" | "stop" | "status" | "migrate",
  instanceId: string,
  commands: PgCommandRunner = runPg,
) {
  const managed = await loadManagedInstance(instanceId);
  await assertPgdata(managed.manifest);
  if (command === "start" || command === "migrate") {
    try {
      await lstat(
        path.join(
          path.dirname(managed.manifest.runtimeConfigPath),
          "recovery-pending.json",
        ),
      );
      fail("RECOVERY_TARGET_NOT_VERIFIED");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (command === "start") {
    // Existing postmaster/occupied port are refusals before any start attempt or compensating stop.
    try {
      await lstat(path.join(managed.manifest.pgdata!, "postmaster.pid"));
      fail("INSTANCE_ALREADY_RUNNING");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await checkPort(managed.manifest.port);
    let started: StartedPostgres;
    try {
      started = await startPostgres(localIdentity(managed.manifest), commands);
    } catch (error) {
      if (error instanceof PgStartError) fail(error.code);
      throw error;
    }
    try {
      const db = await openManagedDatabase(instanceId);
      await db.close();
      return { instanceId, status: "running" };
    } catch {
      fail(
        (await stopStartedPostgres(started, commands))
          ? "START_FAILED_INSTANCE_STOPPED"
          : "START_FAILED_CLEANUP_REQUIRED",
      );
    }
  }
  if (command === "status") {
    try {
      await lstat(path.join(managed.manifest.pgdata!, "postmaster.pid"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { instanceId, status: "stopped" };
      throw error;
    }
  }
  await verifyRunningPgdata(managed.manifest);
  const db = await openManagedDatabase(instanceId);
  try {
    if (command === "migrate")
      return {
        instanceId,
        applied: await migrateDatabase(db.sql, managed.config),
      };
  } finally {
    await db.close();
  }
  if (command === "stop")
    await commands("pg_ctl", [
      "-D",
      managed.manifest.pgdata!,
      "-w",
      "-m",
      "fast",
      "stop",
    ]);
  return { instanceId, status: command === "stop" ? "stopped" : "running" };
}

export async function initCiInstance(input: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}) {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    input.host !== "127.0.0.1" ||
    input.user !== "postgres" ||
    input.database !== "postgres" ||
    !input.password ||
    !Number.isInteger(input.port) ||
    input.port < 1024 ||
    input.port > 65535 ||
    input.port === 5432
  )
    fail("CI_SERVICE_ARGUMENTS_INVALID");
  const service = openSql(
    {
      host: "127.0.0.1",
      port: input.port,
      user: input.user,
      password: input.password,
      name: input.database,
    },
    1,
  );
  try {
    const [fact] =
      await service`SELECT current_database() AS database,current_user AS role,current_setting('server_version_num')::int AS version,host(inet_server_addr()) AS address,inet_server_port() AS port`;
    if (
      !fact ||
      fact.database !== "postgres" ||
      fact.role !== "postgres" ||
      fact.version !== 180004 ||
      fact.port !== 5432 ||
      !/^\d+\.\d+\.\d+\.\d+$/.test(fact.address as string)
    )
      fail("CI_SERVICE_FACTS_INVALID");
    const [pristine] = await service`SELECT
      NOT EXISTS(SELECT 1 FROM pg_database WHERE datname NOT IN ('postgres','template0','template1')) AS databases,
      NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname <> 'postgres' AND rolname !~ '^pg_') AS roles,
      (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser`;
    if (!pristine?.databases || !pristine.roles || !pristine.superuser)
      fail("CI_SERVICE_NOT_PRISTINE");
    const { instanceId, paths } = await newInstanceDirectory();
    const ownerPassword = randomBytes(32).toString("base64url"),
      appPassword = randomBytes(32).toString("base64url");
    await provision(service, instanceId, "ci", ownerPassword, appPassword);
    const config = normalizeRuntimeConfig({
      version: 2,
      imports: { enabled: false },
      profile: "local-http-p2a",
      purpose: "ci",
      origin: "http://127.0.0.1:3100",
      instanceId,
      database: {
        host: "127.0.0.1",
        port: input.port,
        name: `qf_db_${instanceId}`,
        user: `qf_app_${instanceId}`,
        password: appPassword,
      },
      server: { version: fact.version, address: fact.address, port: fact.port },
    });
    const admin: P2aAdminConfig = {
      version: 1,
      instanceId,
      owner: {
        ...config.database,
        user: `qf_owner_${instanceId}`,
        password: ownerPassword,
      },
    };
    const manifest: P2aManifest = {
      version: 1,
      instanceId,
      purpose: "ci",
      mode: "ci",
      origin: config.origin,
      root: process.cwd(),
      port: input.port,
      pgdata: null,
      socket: null,
      runtimeConfigPath: paths.runtime,
      adminConfigPath: paths.admin,
    };
    await writePrivateJson(paths.runtime, runtimeConfigFile(config));
    await writePrivateJson(paths.admin, admin);
    await writePrivateJson(paths.manifest, manifest);
    const managed = await openManagedDatabase(instanceId);
    try {
      await migrateDatabase(managed.sql, config);
    } finally {
      await managed.close();
    }
    return manifest;
  } catch {
    return fail("CI_BOOTSTRAP_FAILED_INSTANCE_PRESERVED");
  } finally {
    await service.end({ timeout: 3 });
  }
}
