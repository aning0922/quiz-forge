import * as net from "node:net";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  launchOwnedPreviewNodeProcess,
  assertPreviewServerRunning,
  stopAndProveServerExit,
  assertServerExitProof,
  type ServerExitProof,
  type OwnedPreviewServer,
} from "../support/p3c-server-owner";
vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  return { ...actual, createServer: vi.fn(actual.createServer) };
});
const cwd = process.cwd();
async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      if (!a || typeof a === "string") throw Error();
      s.close(() => resolve(a.port));
    });
  });
}
it("only actual owned child close plus absent group signs an in-process bound proof", async () => {
  const identity = { cwd, instanceId: "a".repeat(32), runId: randomUUID() };
  const port = await freePort();
  const owner = await launchOwnedPreviewNodeProcess(
    {
      ...identity,
      port,
      runtimeConfigPath: cwd + "/.cache/unused-private-runtime.json",
    },
    ["-e", "process.stdin.resume();setInterval(()=>{},1000)"],
  );
  assertPreviewServerRunning(owner);
  expect(() => assertServerExitProof({} as ServerExitProof, identity)).toThrow(
    "PREVIEW_SERVER_EXIT_UNPROVEN",
  );
  const proof = await stopAndProveServerExit(owner);
  await owner.closed;
  assertServerExitProof(proof, identity);
  expect(() => assertPreviewServerRunning(owner)).toThrow(
    "PREVIEW_SERVER_NOT_RUNNING",
  );
  expect(() =>
    assertServerExitProof(proof, { ...identity, runId: randomUUID() }),
  ).toThrow("PREVIEW_SERVER_EXIT_UNPROVEN");
  expect(() =>
    assertServerExitProof(proof, { ...identity, cwd: cwd + "/other" }),
  ).toThrow("PREVIEW_SERVER_EXIT_UNPROVEN");
  await expect(
    launchOwnedPreviewNodeProcess(
      {
        ...identity,
        port,
        runtimeConfigPath: cwd + "/.cache/unused-private-runtime.json",
      },
      ["-e", ""],
    ),
  ).rejects.toThrow("PREVIEW_SERVER_EXIT_UNPROVEN");
});
it("fake owners cannot stop or certify unknown processes", () => {
  expect(() => stopAndProveServerExit({} as OwnedPreviewServer)).toThrow(
    "PREVIEW_SERVER_EXIT_UNPROVEN",
  );
});
it("a still-owned grandchild is terminated before the parent's proof is valid", async () => {
  const identity = { cwd, instanceId: "b".repeat(32), runId: randomUUID() };
  const owner = await launchOwnedPreviewNodeProcess(
    {
      ...identity,
      port: await freePort(),
      runtimeConfigPath: cwd + "/.cache/unused-private-runtime.json",
    },
    [
      "-e",
      `require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});setInterval(()=>{},1000)`,
    ],
  );
  try {
    assertPreviewServerRunning(owner);
  } finally {
    const proof = await stopAndProveServerExit(owner);
    assertServerExitProof(proof, identity);
  }
});
it("concurrent same-identity real launches issue only one owner and one exit authority", async () => {
  const identity = { cwd, instanceId: "c".repeat(32), runId: randomUUID() };
  const options = {
    ...identity,
    port: await freePort(),
    runtimeConfigPath: cwd + "/.cache/unused-private-runtime.json",
  };
  const args = ["-e", "setInterval(()=>{},1000)"];
  const otherPort = await freePort();
  // Delay actual port-probe close so both callers reach the original await window.
  // Neither a child lifecycle nor a successful close/proof is mocked.
  const create = vi.mocked(net.createServer).getMockImplementation()!;
  const pending: (() => void)[] = [];
  const timers: ReturnType<typeof setTimeout>[] = [];
  const probe = vi
    .spyOn(net, "createServer")
    .mockImplementation((...args: Parameters<typeof net.createServer>) => {
      const server = create(...args),
        close = server.close.bind(server);
      vi.spyOn(server, "close").mockImplementation((callback) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          close(callback);
        };
        pending.push(finish);
        timers.push(setTimeout(finish, 200));
        if (pending.length === 2) pending.forEach((f) => f());
        return server;
      });
      return server;
    });
  let results: PromiseSettledResult<OwnedPreviewServer>[];
  try {
    results = await Promise.allSettled([
      launchOwnedPreviewNodeProcess(options, args),
      launchOwnedPreviewNodeProcess({ ...options, port: otherPort }, args),
    ]);
  } finally {
    probe.mockRestore();
    timers.forEach(clearTimeout);
    pending.forEach((f) => f());
  }

  const owned = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  try {
    expect(owned).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    assertPreviewServerRunning(owned[0]!);
    const proof = await stopAndProveServerExit(owned[0]!);
    assertServerExitProof(proof, identity);
    await expect(launchOwnedPreviewNodeProcess(options, args)).rejects.toThrow(
      "PREVIEW_SERVER_EXIT_UNPROVEN",
    );
  } finally {
    // Also stop both children if this assertion ever regresses to the original race.
    await Promise.all(owned.map((child) => stopAndProveServerExit(child)));
  }
});
it("failed real port acquisition retires its identity instead of allowing a later reuse", async () => {
  const port = await freePort(),
    server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const options = {
    cwd,
    instanceId: "d".repeat(32),
    runId: randomUUID(),
    port,
    runtimeConfigPath: cwd + "/.cache/unused-private-runtime.json",
  };
  try {
    await expect(
      launchOwnedPreviewNodeProcess(options, [
        "-e",
        "setInterval(()=>{},1000)",
      ]),
    ).rejects.toThrow("PREVIEW_SERVER_EXIT_UNPROVEN");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
  await expect(
    launchOwnedPreviewNodeProcess(options, ["-e", "setInterval(()=>{},1000)"]),
  ).rejects.toThrow("PREVIEW_SERVER_EXIT_UNPROVEN");
});
