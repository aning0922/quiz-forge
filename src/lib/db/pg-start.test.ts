import { randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  initLocalInstance,
  instancePaths,
  manageLocalInstance,
  writePrivateJson,
} from "./management";
import { PgCommandError, type PgCommandRunner } from "./pg-command";
import {
  readPostmaster,
  startPostgres,
  stopStartedPostgres,
  type LocalPgIdentity,
} from "./pg-start";

const ownedDirectories: string[] = [];
afterEach(async () => {
  for (const dir of ownedDirectories.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function fixture(): Promise<LocalPgIdentity> {
  const port = await freePort();
  const id = randomBytes(16).toString("hex"),
    paths = instancePaths(id);
  await mkdir(path.dirname(paths.directory), { recursive: true, mode: 0o700 });
  await mkdir(paths.directory, { mode: 0o700 });
  ownedDirectories.push(paths.directory);
  await mkdir(paths.pgdata, { mode: 0o700 });
  await mkdir(paths.socket, { mode: 0o700 });
  await writeFile(path.join(paths.pgdata, "PG_VERSION"), "18\n", {
    mode: 0o600,
  });
  await writeFile(
    path.join(paths.pgdata, "postgresql.conf"),
    `\n# quizforge.p2a:${id}\nlisten_addresses = '127.0.0.1'\nport = ${port}\n`,
    { mode: 0o600 },
  );
  return {
    instanceId: id,
    pgdata: paths.pgdata,
    socket: paths.socket,
    port,
  };
}
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return server.close(() => reject(new Error("TEST_PORT_UNAVAILABLE")));
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}
async function pidFile(
  identity: LocalPgIdentity,
  overrides: { pid?: string; host?: string; startedAt?: number } = {},
) {
  // The injected runner never launches/stops an OS process; these are synthetic postmaster facts.
  await writeFile(
    path.join(identity.pgdata, "postmaster.pid"),
    `${overrides.pid ?? "7654321"}\n${identity.pgdata}\n${overrides.startedAt ?? Math.floor(Date.now() / 1000)}\n${identity.port}\n../socket\n${overrides.host ?? "127.0.0.1"}\n0\nready\n`,
    { mode: 0o600 },
  );
}
async function managedFixture(identity: LocalPgIdentity) {
  const paths = instancePaths(identity.instanceId);
  const config = {
    version: 1,
    profile: "local-http-p2a",
    purpose: "test",
    origin: "http://127.0.0.1:3100",
    instanceId: identity.instanceId,
    database: {
      host: "127.0.0.1",
      port: identity.port,
      name: `qf_db_${identity.instanceId}`,
      user: `qf_app_${identity.instanceId}`,
      password: randomBytes(32).toString("base64url"),
    },
    server: { version: 180004, address: "127.0.0.1", port: identity.port },
  };
  await writePrivateJson(paths.runtime, config);
  await writePrivateJson(paths.admin, {
    version: 1,
    instanceId: identity.instanceId,
    owner: { ...config.database, user: `qf_owner_${identity.instanceId}` },
  });
  await writePrivateJson(paths.manifest, {
    version: 1,
    instanceId: identity.instanceId,
    purpose: "test",
    mode: "local",
    origin: config.origin,
    root: process.cwd(),
    port: identity.port,
    pgdata: paths.pgdata,
    socket: paths.socket,
    runtimeConfigPath: paths.runtime,
    adminConfigPath: paths.admin,
  });
}
async function recordLaunchOptions(identity: LocalPgIdentity, args: string[]) {
  const options = args[args.indexOf("-o") + 1] ?? "";
  const tag = options.slice("-c ".length);
  await writeFile(
    path.join(identity.pgdata, "postmaster.opts"),
    `postgres "-D" "${identity.pgdata}" "-c" "${tag}"\n`,
    { mode: 0o600 },
  );
}
describe("controlled local PG startup failures", () => {
  it("stops the matching instance when pg_ctl reports failure after starting it", async () => {
    const identity = await fixture(),
      calls: string[] = [];
    const commands: PgCommandRunner = async (_, args) => {
      const command = args.at(-1)!;
      calls.push(command);
      if (command === "start") {
        await recordLaunchOptions(identity, args);
        await pidFile(identity);
        throw new PgCommandError(true, 1);
      }
      await unlink(path.join(identity.pgdata, "postmaster.pid"));
      return "";
    };
    await expect(startPostgres(identity, commands)).rejects.toMatchObject({
      code: "START_FAILED_INSTANCE_STOPPED",
    });
    expect(calls).toEqual(["start", "stop"]);
    await expect(
      lstat(path.join(identity.pgdata, "postmaster.pid")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      lstat(path.join(path.dirname(identity.pgdata), "start.lock")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("reports unknown cleanup when timeout has no confirming postmaster facts", async () => {
    const identity = await fixture(),
      calls: string[] = [];
    await expect(
      startPostgres(identity, async (_, args) => {
        calls.push(args.at(-1)!);
        throw new PgCommandError(true);
      }),
    ).rejects.toMatchObject({ code: "START_FAILED_CLEANUP_REQUIRED" });
    expect(calls).toEqual(["start"]);
  });
  it("does not stop an instance that was already running before the call", async () => {
    const identity = await fixture();
    await pidFile(identity);
    let called = false;
    await expect(
      startPostgres(identity, async () => {
        called = true;
        return "";
      }),
    ).rejects.toMatchObject({ code: "INSTANCE_ALREADY_RUNNING" });
    expect(called).toBe(false);
    expect((await readPostmaster(identity)).pid).toBe("7654321");
  });
  it("distinguishes a command that never spawned from an unknown launched process", async () => {
    const identity = await fixture();
    let calls = 0;
    await expect(
      startPostgres(identity, async () => {
        calls++;
        throw new PgCommandError(false);
      }),
    ).rejects.toMatchObject({ code: "START_FAILED_NOT_STARTED" });
    expect(calls).toBe(1);
    await expect(
      startPostgres(identity, async () => {
        calls++;
        await pidFile(identity);
        throw new PgCommandError(false);
      }),
    ).rejects.toMatchObject({ code: "START_FAILED_CLEANUP_REQUIRED" });
    expect(calls).toBe(2);
  });
  it.each([
    "foreign",
    "old",
    "stop-failed",
    "foreign-launch",
    "missing-launch",
  ])("refuses unconfirmed cleanup: %s", async (kind) => {
    const identity = await fixture(),
      calls: string[] = [];
    await expect(
      startPostgres(identity, async (_, args) => {
        const command = args.at(-1)!;
        calls.push(command);
        if (command === "start") {
          if (kind !== "missing-launch")
            await recordLaunchOptions(
              identity,
              kind === "foreign-launch"
                ? ["-o", "-c cluster_name=other-attempt"]
                : args,
            );
          await pidFile(
            identity,
            kind === "foreign"
              ? { host: "0.0.0.0" }
              : kind === "old"
                ? { startedAt: 1 }
                : {},
          );
        }
        throw new PgCommandError(true, 1);
      }),
    ).rejects.toMatchObject({ code: "START_FAILED_CLEANUP_REQUIRED" });
    expect(calls).toEqual(
      kind === "stop-failed" ? ["start", "stop"] : ["start"],
    );
  });
  it("does not stop a replacement postmaster or overwrite another start guard", async () => {
    const identity = await fixture();
    await pidFile(identity);
    const previous = await readPostmaster(identity);
    await pidFile(identity, { pid: "7654322" });
    let called = false;
    expect(
      await stopStartedPostgres(previous, async () => {
        called = true;
        return "";
      }),
    ).toBe(false);
    expect(called).toBe(false);
    const lock = path.join(path.dirname(identity.pgdata), "start.lock");
    await writeFile(lock, "existing", { mode: 0o600, flag: "wx" });
    await expect(
      startPostgres(identity, async () => {
        called = true;
        return "";
      }),
    ).rejects.toMatchObject({ code: "START_OPERATION_CONFLICT" });
    expect(await readFile(lock, "utf8")).toBe("existing");
  });
  it("management start uses the same compensation and refuses existing instances", async () => {
    const identity = await fixture();
    await managedFixture(identity);
    const calls: string[] = [];
    const commands: PgCommandRunner = async (_, args) => {
      const command = args.at(-1)!;
      calls.push(command);
      if (command === "start") {
        await recordLaunchOptions(identity, args);
        await pidFile(identity);
        throw new PgCommandError(true, 1);
      }
      await unlink(path.join(identity.pgdata, "postmaster.pid"));
      return "";
    };
    await expect(
      manageLocalInstance("start", identity.instanceId, commands),
    ).rejects.toMatchObject({ code: "START_FAILED_INSTANCE_STOPPED" });
    expect(calls).toEqual(["start", "stop"]);
    await pidFile(identity);
    await expect(
      manageLocalInstance("start", identity.instanceId, commands),
    ).rejects.toMatchObject({ code: "INSTANCE_ALREADY_RUNNING" });
    expect(calls).toEqual(["start", "stop"]);
  });
  it.each([true, false])(
    "initialization propagates confirmed/unknown startup cleanup: stopped=%s",
    async (confirm) => {
      const port = await freePort();
      let identity: LocalPgIdentity | undefined;
      const calls: string[] = [];
      const commands: PgCommandRunner = async (program, args) => {
        if (args.includes("--version")) return "PostgreSQL 18.4 (synthetic)";
        const pgdata = args[args.indexOf("-D") + 1]!;
        if (program === "initdb") {
          const directory = path.dirname(pgdata);
          ownedDirectories.push(directory);
          identity = {
            instanceId: path.basename(directory),
            pgdata,
            socket: path.join(directory, "socket"),
            port,
          };
          await mkdir(pgdata, { mode: 0o700 });
          await writeFile(path.join(pgdata, "PG_VERSION"), "18\n", {
            mode: 0o600,
          });
          return "";
        }
        const command = args.at(-1)!;
        calls.push(command);
        if (command === "start") {
          await recordLaunchOptions(identity!, args);
          if (confirm) await pidFile(identity!);
          throw new PgCommandError(true, 1);
        }
        await unlink(path.join(identity!.pgdata, "postmaster.pid"));
        return "";
      };
      await expect(
        initLocalInstance(
          { port, origin: "http://127.0.0.1:3100", purpose: "test" },
          commands,
        ),
      ).rejects.toMatchObject({
        code: confirm
          ? "INIT_FAILED_INSTANCE_PRESERVED"
          : "INIT_FAILED_CLEANUP_REQUIRED",
      });
      expect(calls).toEqual(confirm ? ["start", "stop"] : ["start"]);
      await expect(
        lstat(path.join(path.dirname(identity!.pgdata), "init-password")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
});
