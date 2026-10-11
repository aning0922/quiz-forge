import "server-only";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { PgCommandError, runPg, type PgCommandRunner } from "./pg-command";

export type LocalPgIdentity = {
  instanceId: string;
  pgdata: string;
  socket: string;
  port: number;
};
export type StartedPostgres = {
  identity: LocalPgIdentity;
  pid: string;
  startedAt: number;
  launchTag?: string;
};
export class PgStartError extends Error {
  constructor(
    readonly code:
      | "INSTANCE_ALREADY_RUNNING"
      | "PGDATA_IDENTITY_INVALID"
      | "START_FAILED_INSTANCE_STOPPED"
      | "START_FAILED_NOT_STARTED"
      | "START_FAILED_CLEANUP_REQUIRED"
      | "START_OPERATION_CONFLICT",
  ) {
    super(code);
  }
}

export async function assertLocalPgdata(
  identity: LocalPgIdentity,
): Promise<void> {
  const root = path.join(process.cwd(), ".cache", "p2a", identity.instanceId);
  if (
    !/^[a-f0-9]{32}$/.test(identity.instanceId) ||
    identity.pgdata !== path.join(root, "pgdata") ||
    identity.socket !== path.join(root, "socket")
  )
    throw new PgStartError("PGDATA_IDENTITY_INVALID");
  for (const dir of [root, identity.pgdata, identity.socket]) {
    const stat = await lstat(dir);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o777) !== 0o700 ||
      stat.uid !== process.getuid?.() ||
      (await realpath(dir)) !== dir
    )
      throw new PgStartError("PGDATA_IDENTITY_INVALID");
  }
  if (
    (
      await readFile(path.join(identity.pgdata, "PG_VERSION"), "utf8")
    ).trim() !== "18" ||
    !(
      await readFile(path.join(identity.pgdata, "postgresql.conf"), "utf8")
    ).includes(
      `\n# quizforge.p2a:${identity.instanceId}\nlisten_addresses = '127.0.0.1'\nport = ${identity.port}\n`,
    )
  )
    throw new PgStartError("PGDATA_IDENTITY_INVALID");
}

export async function readPostmaster(
  identity: LocalPgIdentity,
): Promise<StartedPostgres> {
  await assertLocalPgdata(identity);
  const handle = await open(
    path.join(identity.pgdata, "postmaster.pid"),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.size > 4096)
      throw new PgStartError("PGDATA_IDENTITY_INVALID");
    const bytes = Buffer.alloc(4097);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const lines = bytes.subarray(0, bytesRead).toString("utf8").split("\n");
    if (
      bytesRead > 4096 ||
      !/^[1-9][0-9]*$/.test(lines[0] ?? "") ||
      !/^[1-9][0-9]*$/.test(lines[2] ?? "") ||
      lines[1] !== identity.pgdata ||
      lines[3] !== String(identity.port) ||
      path.resolve(identity.pgdata, lines[4] ?? "") !== identity.socket ||
      lines[5] !== "127.0.0.1"
    )
      throw new PgStartError("PGDATA_IDENTITY_INVALID");
    return { identity, pid: lines[0]!, startedAt: Number(lines[2]) };
  } finally {
    await handle.close();
  }
}

async function pidAbsent(identity: LocalPgIdentity): Promise<boolean> {
  try {
    await lstat(path.join(identity.pgdata, "postmaster.pid"));
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

async function matchesLaunchTag(
  identity: LocalPgIdentity,
  tag: string,
): Promise<boolean> {
  const handle = await open(
    path.join(identity.pgdata, "postmaster.opts"),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.size > 4096)
      return false;
    const bytes = Buffer.alloc(4097);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return (
      bytesRead <= 4096 &&
      bytes
        .subarray(0, bytesRead)
        .toString("utf8")
        .includes(`"cluster_name=${tag}"`)
    );
  } finally {
    await handle.close();
  }
}

// Only a matching postmaster observed during this exclusive start attempt may be stopped.
export async function stopStartedPostgres(
  started: StartedPostgres,
  commands: PgCommandRunner = runPg,
): Promise<boolean> {
  try {
    const current = await readPostmaster(started.identity);
    if (current.pid !== started.pid || current.startedAt !== started.startedAt)
      return false;
    if (
      started.launchTag &&
      !(await matchesLaunchTag(started.identity, started.launchTag))
    )
      return false;
    await commands("pg_ctl", [
      "-D",
      started.identity.pgdata,
      "-w",
      "-t",
      "5",
      "-m",
      "fast",
      "stop",
    ]);
    return await pidAbsent(started.identity);
  } catch {
    return false;
  }
}

export async function startPostgres(
  identity: LocalPgIdentity,
  commands: PgCommandRunner = runPg,
): Promise<StartedPostgres> {
  await assertLocalPgdata(identity);
  const guardPath = path.join(path.dirname(identity.pgdata), "start.lock");
  let guard;
  try {
    guard = await open(
      guardPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
  } catch {
    throw new PgStartError("START_OPERATION_CONFLICT");
  }
  const owned = await guard.stat();
  let attempted = false;
  const earliestStart = Math.floor(Date.now() / 1000);
  const launchTag = `qf_p2a_start_${randomBytes(16).toString("hex")}`;
  try {
    if (!(await pidAbsent(identity)))
      throw new PgStartError("INSTANCE_ALREADY_RUNNING");
    attempted = true;
    try {
      await commands("pg_ctl", [
        "-D",
        identity.pgdata,
        "-l",
        path.join(path.dirname(identity.pgdata), "server.log"),
        "-w",
        "-o",
        `-c cluster_name=${launchTag}`,
        "start",
      ]);
      const started = await readPostmaster(identity);
      if (
        started.startedAt < earliestStart ||
        !(await matchesLaunchTag(identity, launchTag))
      )
        throw new PgStartError("PGDATA_IDENTITY_INVALID");
      return { ...started, launchTag };
    } catch (error) {
      if (error instanceof PgCommandError && !error.spawned)
        throw new PgStartError(
          (await pidAbsent(identity))
            ? "START_FAILED_NOT_STARTED"
            : "START_FAILED_CLEANUP_REQUIRED",
        );
      // pg_ctl may have failed after launching postgres. Absence or incomplete/foreign facts do not prove shutdown.
      let stopped = false;
      try {
        const started = await readPostmaster(identity);
        stopped =
          started.startedAt >= earliestStart &&
          (await matchesLaunchTag(identity, launchTag)) &&
          (await stopStartedPostgres({ ...started, launchTag }, commands));
      } catch {}
      throw new PgStartError(
        stopped
          ? "START_FAILED_INSTANCE_STOPPED"
          : "START_FAILED_CLEANUP_REQUIRED",
      );
    }
  } finally {
    await guard.close();
    try {
      const stat = await lstat(guardPath);
      if (
        stat.ino !== owned.ino ||
        stat.dev !== owned.dev ||
        stat.isSymbolicLink()
      )
        throw new Error();
      await unlink(guardPath);
    } catch {
      throw new PgStartError(
        attempted
          ? "START_FAILED_CLEANUP_REQUIRED"
          : "START_OPERATION_CONFLICT",
      );
    }
  }
}
