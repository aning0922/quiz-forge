import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  launchOwnedPreviewNodeProcess,
  stopAndProveServerExit,
  type ServerExitProof,
} from "../support/p3c-server-owner";
import { observeP3eBackendExit } from "../support/p3e-backend-exit";

const identity = {
  cwd: process.cwd(),
  instanceId: "e".repeat(32),
  runId: randomUUID(),
};
let proof: ServerExitProof;
beforeAll(async () => {
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(Error("PORT_REQUIRED"));
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
  const child = await launchOwnedPreviewNodeProcess(
    {
      ...identity,
      port,
      runtimeConfigPath: identity.cwd + "/.cache/unused-private-runtime.json",
    },
    ["-e", "setInterval(()=>{},1000)"],
  );
  proof = await stopAndProveServerExit(child);
});
afterAll(() => vi.useRealTimers());

it("requires a real identity-bound exit proof before reading backend state", async () => {
  const read = vi.fn(async () => ({ connections: 0, guards: 0 }));
  await expect(
    observeP3eBackendExit({} as ServerExitProof, identity, read),
  ).rejects.toThrow("PREVIEW_SERVER_EXIT_UNPROVEN");
  await expect(
    observeP3eBackendExit(proof, { ...identity, runId: randomUUID() }, read),
  ).rejects.toThrow("PREVIEW_SERVER_EXIT_UNPROVEN");
  expect(read).not.toHaveBeenCalled();
});

it("requires both exact counts to reach zero after the real child exits", async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce({ connections: 1, guards: 0 })
    .mockResolvedValueOnce({ connections: 0, guards: 1 })
    .mockResolvedValueOnce({ connections: 0, guards: 0 });
  await expect(observeP3eBackendExit(proof, identity, read)).resolves.toEqual({
    connections: 0,
    guards: 0,
  });
  expect(read).toHaveBeenCalledTimes(3);
});

it("propagates an observation failure without retrying or claiming exit", async () => {
  const error = Error("TEST_QUERY_FAILED"),
    read = vi.fn().mockRejectedValue(error);
  await expect(observeP3eBackendExit(proof, identity, read)).rejects.toBe(
    error,
  );
  expect(read).toHaveBeenCalledTimes(1);
});

it("preserves missing backend evidence as failure", async () => {
  const read = vi.fn().mockResolvedValue(undefined);
  await expect(observeP3eBackendExit(proof, identity, read)).rejects.toThrow(
    "CLOSE_FAULT_BACKEND_STATE_MISSING_PRESERVED",
  );
  expect(read).toHaveBeenCalledTimes(1);
});

it("fails at the finite observation bound when a backend remains", async () => {
  vi.useFakeTimers({ toFake: ["performance"] });
  const read = vi.fn(async () => {
    vi.advanceTimersByTime(2000);
    return { connections: 1, guards: 0 };
  });
  try {
    await expect(observeP3eBackendExit(proof, identity, read)).rejects.toThrow(
      "CLOSE_FAULT_BACKENDS_EXIT_UNPROVEN_PRESERVED",
    );
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("does not accept a zero observation returned after the bound", async () => {
  vi.useFakeTimers({ toFake: ["performance"] });
  const read = vi.fn(async () => {
    vi.advanceTimersByTime(2001);
    return { connections: 0, guards: 0 };
  });
  try {
    await expect(observeP3eBackendExit(proof, identity, read)).rejects.toThrow(
      "CLOSE_FAULT_BACKENDS_EXIT_UNPROVEN_PRESERVED",
    );
  } finally {
    vi.useRealTimers();
  }
});
