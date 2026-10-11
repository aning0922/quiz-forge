import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rmdir, rm, symlink, writeFile, open } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { normalizeRuntimeConfig } from "@/lib/db/runtime";
import { createReceiveContext } from "./context";
import { measuredQuota, requireQuota } from "./quota";
import {
  ensureStorage,
  importDirectory,
  importsDirectory,
  ownerExited,
  scanStorage,
  stopped,
  writeStopped,
  type Attempt,
} from "./storage";
import type { ImportRow } from "./repository";
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const id = randomBytes(16).toString("hex");
  const config = normalizeRuntimeConfig({
    version: 2,
    imports: { enabled: true },
    profile: "local-http-p2a",
    purpose: "test",
    origin: "http://127.0.0.1:3100",
    instanceId: id,
    database: {
      host: "127.0.0.1",
      port: 55421,
      name: `qf_db_${id}`,
      user: `qf_app_${id}`,
      password: "A".repeat(43),
    },
    server: { version: 180004, address: "127.0.0.1", port: 55421 },
  });
  const dir = path.join(process.cwd(), ".cache", "p2a", id);
  await mkdir(dir, { mode: 0o700 });
  dirs.push(dir);
  await ensureStorage(config);
  return config;
}
async function scan(config: Awaited<ReturnType<typeof fixture>>) {
  const { context, dispose } = createReceiveContext(
    new AbortController().signal,
  );
  try {
    return await scanStorage(config, context);
  } finally {
    dispose();
  }
}
it("uses actual logical bytes and held headroom, double names and conservative orphan accounting", async () => {
  const config = await fixture(),
    id = randomUUID();
  await mkdir(importDirectory(config, id), { mode: 0o700 });
  const partial = path.join(
    importDirectory(config, id),
    `attempt-${id}.partial`,
  );
  await writeFile(partial, Buffer.alloc(10), { mode: 0o600 });
  const snapshot = await scan(config);
  const row = {
    id,
    reserved_bytes: "100",
    attempts: [{ attemptId: id, reservationBytes: 100, disposition: "held" }],
  } as ImportRow;
  expect(measuredQuota(snapshot, [row])).toBe(100);
  expect(measuredQuota(snapshot, [])).toBe(10);
  requireQuota(536870912);
  expect(() => requireQuota(536870912, 1)).toThrow("RECEIVE_QUOTA_EXCEEDED");
  await writeFile(
    path.join(importDirectory(config, id), "archive.quizpack"),
    Buffer.alloc(10),
    { mode: 0o600 },
  );
  expect(measuredQuota(await scan(config), [row])).toBe(110);
  const handle = await open(partial, "r+");
  try {
    await handle.truncate(536870913);
  } finally {
    await handle.close();
  }
  expect(() =>
    requireQuota(measuredQuota({ bytes: 536870913, files: new Map() }, [])),
  ).toThrow("RECEIVE_QUOTA_EXCEEDED");
});
it("rejects each unknown directory, links and file +1 without partial scan success", async () => {
  const config = await fixture(),
    id = randomUUID(),
    dir = importDirectory(config, id);
  await mkdir(dir, { mode: 0o700 });
  await mkdir(path.join(dir, "unexpected"), { mode: 0o700 });
  await expect(scan(config)).rejects.toThrow("RECEIVE_STORAGE_CONFLICT");
  await rmdir(path.join(dir, "unexpected"));
  const archive = path.join(dir, "archive.quizpack");
  await symlink("/dev/null", archive);
  await expect(scan(config)).rejects.toThrow("RECEIVE_STORAGE_CONFLICT");
  await rm(archive);
  for (let i = 0; i < 17; i++)
    await writeFile(path.join(dir, `attempt-${randomUUID()}.partial`), "", {
      mode: 0o600,
    });
  await expect(scan(config)).rejects.toThrow("RECEIVE_SCAN_LIMIT");
});
it("refuses the 1025th import directory and accepts the exact 1024 shape", async () => {
  const config = await fixture();
  for (let i = 0; i < 1024; i++)
    await mkdir(path.join(importsDirectory(config), randomUUID()), {
      mode: 0o700,
    });
  expect((await scan(config)).files.size).toBe(1024);
  await mkdir(path.join(importsDirectory(config), randomUUID()), {
    mode: 0o700,
  });
  await expect(scan(config)).rejects.toThrow("RECEIVE_SCAN_LIMIT");
});
it("validates stopped identity, nonce/fence and actual 2049-byte receipt boundary", async () => {
  const config = await fixture(),
    id = randomUUID();
  await mkdir(importDirectory(config, id), { mode: 0o700 });
  const a: Attempt = {
    attemptId: randomUUID(),
    fence: 1,
    ownerPid: process.pid,
    ownerNonce: randomBytes(32).toString("base64url"),
    reservationBytes: 65538,
    disposition: "held",
  };
  await writeStopped(config, id, a);
  expect(await stopped(config, id, a)).toBe(true);
  expect(await stopped(config, id, { ...a, attemptId: randomUUID() })).toBe(
    false,
  );
  await expect(stopped(config, id, { ...a, fence: 2 })).rejects.toThrow(
    "RECEIVE_STORAGE_CONFLICT",
  );
  await expect(
    stopped(config, id, { ...a, ownerNonce: "A".repeat(43) }),
  ).rejects.toThrow("RECEIVE_STORAGE_CONFLICT");
  const file = path.join(
    importDirectory(config, id),
    `stopped-${a.attemptId}.json`,
  );
  await writeFile(file, " ".repeat(2049));
  await expect(stopped(config, id, a)).rejects.toThrow(
    "RECEIVE_STORAGE_CONFLICT",
  );
});
it("ESRCH alone proves stop; successful probe, PID reuse, EPERM and invalid PID preserve ownership", () => {
  const probe = (code?: string) => {
    return (() => {
      if (code) throw Object.assign(new Error("PROBE"), { code });
      return true;
    }) as typeof process.kill;
  };
  expect(ownerExited(1, probe("ESRCH"))).toBe(true);
  for (const code of [undefined, "EPERM", "UNKNOWN"])
    expect(ownerExited(1, probe(code))).toBe(false);
  expect(ownerExited(0, probe("ESRCH"))).toBe(false);
});
