import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  launchOwnedPreviewNodeProcess,
  assertPreviewServerRunning,
  stopAndProveServerExit,
  assertServerExitProof,
  type ServerExitProof,
  type OwnedPreviewServer,
} from "../support/p3c-server-owner";
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
