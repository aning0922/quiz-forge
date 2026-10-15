import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

declare const serverOwner: unique symbol, serverExit: unique symbol;
export type OwnedPreviewServer = Readonly<{
  [serverOwner]: true;
  closed: Promise<void>;
}>;
export type ServerExitProof = Readonly<{ [serverExit]: true }>;
export type PreviewServerIdentity = Readonly<{
  cwd: string;
  instanceId: string;
  runId: string;
}>;
export type PreviewServerOptions = PreviewServerIdentity &
  Readonly<{
    port: number;
    runtimeConfigPath: string;
    env?: NodeJS.ProcessEnv;
  }>;
type State = {
  identity: PreviewServerIdentity;
  launchId: string;
  ownerPid: number;
  child: ChildProcess;
  port: number;
  closed: boolean;
  close: Promise<void>;
  failed: boolean;
  proof?: Promise<ServerExitProof>;
};
const owners = new WeakMap<object, State>(),
  proofs = new WeakMap<object, State>();
const launches = new Set<string>();
const invalid = () => Error("PREVIEW_SERVER_EXIT_UNPROVEN");
function absentGroup(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
    throw invalid();
  }
}
async function portFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", () => reject(invalid()));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () =>
      server.close((error) => (error ? reject(invalid()) : resolve())),
    );
  });
}
function state(owner: OwnedPreviewServer): State {
  const s = owner && typeof owner === "object" ? owners.get(owner) : undefined;
  if (!s || s.ownerPid !== process.pid) throw invalid();
  return s;
}
/** Test-only owned Node child. No arbitrary-process adoption, shell, serialized proof or caller PID. */
export async function launchOwnedPreviewNodeProcess(
  options: PreviewServerOptions,
  args: readonly string[],
): Promise<OwnedPreviewServer> {
  if (
    !/^[a-f0-9]{32}$/.test(options.instanceId) ||
    !/^([a-f0-9]{8}-){1}[a-f0-9-]{27}$/.test(options.runId) ||
    !Number.isInteger(options.port) ||
    options.port < 1024 ||
    options.port > 65535 ||
    !path.isAbsolute(options.cwd) ||
    (await realpath(options.cwd)) !== options.cwd ||
    !path.isAbsolute(options.runtimeConfigPath)
  )
    throw invalid();
  const identity = {
    cwd: options.cwd,
    instanceId: options.instanceId,
    runId: options.runId,
  };
  const key = JSON.stringify(identity);
  if (launches.has(key)) throw invalid();
  await portFree(options.port);
  launches.add(key);
  const child = spawn(process.execPath, [...args], {
    cwd: options.cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...options.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      QUIZFORGE_P2A_CONFIG: options.runtimeConfigPath,
    },
  });
  const s: State = {
    identity,
    launchId: randomUUID(),
    ownerPid: process.pid,
    child,
    port: options.port,
    closed: false,
    close: Promise.resolve(),
    failed: false,
  };
  s.close = new Promise<void>((resolve) => {
    child.once("close", () => {
      s.closed = true;
      resolve();
    });
  });
  child.once("error", () => {
    s.failed = true;
  });
  let bytes = 0;
  for (const stream of [child.stdout, child.stderr])
    stream?.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 512 * 1024) {
        s.failed = true;
        try {
          if (child.pid) process.kill(-child.pid, "SIGTERM");
        } catch {
          /* Proof still needs actual close + absence. */
        }
      }
    });
  const owner = Object.freeze({ closed: s.close }) as OwnedPreviewServer;
  owners.set(owner, s);
  return owner;
}
export async function launchPreviewServer(
  options: PreviewServerOptions,
): Promise<OwnedPreviewServer> {
  const require = createRequire(path.join(options.cwd, "package.json"));
  return launchOwnedPreviewNodeProcess(options, [
    require.resolve("next/dist/bin/next"),
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(options.port),
  ]);
}
export function assertPreviewServerRunning(owner: OwnedPreviewServer): void {
  const s = state(owner);
  if (!s.child.pid || s.closed || s.failed || absentGroup(s.child.pid))
    throw Error("PREVIEW_SERVER_NOT_RUNNING");
}
export function stopAndProveServerExit(
  owner: OwnedPreviewServer,
): Promise<ServerExitProof> {
  const s = state(owner);
  if (s.proof) return s.proof;
  s.proof = (async () => {
    const pid = s.child.pid;
    if (!pid) throw invalid();
    const signal = (value: NodeJS.Signals) => {
      try {
        process.kill(-pid, value);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw invalid();
      }
    };
    signal("SIGTERM");
    const started = performance.now(),
      deadline = started + 5000;
    while ((!s.closed || !absentGroup(pid)) && performance.now() < deadline) {
      if (performance.now() - started >= 2000) signal("SIGKILL");
      await delay(25);
    }
    // Only the real close event resolves close. No timeout fallback may manufacture this fact.
    if (!s.closed || !absentGroup(pid)) throw invalid();
    await s.close;
    await portFree(s.port);
    const proof = Object.freeze({}) as ServerExitProof;
    proofs.set(proof, s);
    return proof;
  })();
  return s.proof;
}
export function assertServerExitProof(
  proof: ServerExitProof,
  expected: PreviewServerIdentity,
): void {
  const s = proof && typeof proof === "object" ? proofs.get(proof) : undefined;
  if (
    !s ||
    s.ownerPid !== process.pid ||
    !s.closed ||
    !s.child.pid ||
    !absentGroup(s.child.pid) ||
    s.identity.cwd !== expected.cwd ||
    s.identity.instanceId !== expected.instanceId ||
    s.identity.runId !== expected.runId ||
    !s.launchId
  )
    throw invalid();
}
