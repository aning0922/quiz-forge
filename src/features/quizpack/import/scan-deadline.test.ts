import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { normalizeRuntimeConfig } from "@/lib/db/runtime";
import {
  ensureStorage,
  importDirectory,
  scanStorage,
  type Scan,
} from "./storage";
import type { ImportRow } from "./repository";
import { requireReceiveCapacity } from "./quota";
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return { ...real, lstat: vi.fn(real.lstat) };
});
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of directories.splice(0))
    await rm(d, { recursive: true, force: true });
});
async function fixture() {
  const id = randomBytes(16).toString("hex"),
    dir = path.join(process.cwd(), ".cache", "p2a", id);
  await mkdir(dir, { mode: 0o700 });
  directories.push(dir);
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
  await ensureStorage(config);
  const importId = randomUUID();
  await mkdir(importDirectory(config, importId), { mode: 0o700 });
  await writeFile(
    path.join(importDirectory(config, importId), "archive.quizpack"),
    "x",
    { mode: 0o600 },
  );
  return { config, importId };
}
it.each([5000, 6001])(
  "last legal lstat finishing at %dms does not return successful scan",
  async (end) => {
    const { config } = await fixture();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const real = (await vi.importActual<typeof fs>("node:fs/promises")).lstat;
    vi.spyOn(fs, "lstat").mockImplementation(
      async (...args: Parameters<typeof fs.lstat>) => {
        const value = await real(...args);
        if (String(args[0]).endsWith("archive.quizpack")) now = end;
        return value;
      },
    );
    await expect(
      scanStorage(config, {
        signal: new AbortController().signal,
        deadlineMonotonicMs: 60000,
      }),
    ).rejects.toThrow("RECEIVE_SCAN_LIMIT");
  },
);
it("ensureStorage consumes the same scan budget established at function entry", async () => {
  const { config } = await fixture();
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const real = (await vi.importActual<typeof fs>("node:fs/promises")).lstat;
  vi.spyOn(fs, "lstat").mockImplementation(
    async (...args: Parameters<typeof fs.lstat>) => {
      const value = await real(...args);
      if (String(args[0]).endsWith(config.instanceId)) now = 5000;
      return value;
    },
  );
  await expect(
    scanStorage(config, {
      signal: new AbortController().signal,
      deadlineMonotonicMs: 60000,
    }),
  ).rejects.toThrow("RECEIVE_SCAN_LIMIT");
});
it("reserves all new namespace names before claim, exactly at each capacity and +1", () => {
  const id = randomUUID(),
    other = randomUUID();
  const empty: Scan = { bytes: 0, entries: 1, files: new Map() };
  requireReceiveCapacity(empty, id);
  const directories = new Map(
    Array.from({ length: 1024 }, () => [randomUUID(), []]),
  );
  expect(() =>
    requireReceiveCapacity({ ...empty, files: directories }, id),
  ).toThrow("RECEIVE_SCAN_LIMIT");
  directories.delete(directories.keys().next().value!);
  requireReceiveCapacity({ ...empty, files: directories }, id);
  const files = Array.from({ length: 12 }, () => ({
    file: `attempt-${randomUUID()}.partial`,
    size: 0,
  }));
  const current = {
    ...empty,
    files: new Map([
      [id, files],
      [other, []],
    ]),
  } as Scan;
  requireReceiveCapacity(current, id);
  files.push({ file: `attempt-${randomUUID()}.partial`, size: 0 });
  expect(() => requireReceiveCapacity(current, id)).toThrow(
    "RECEIVE_SCAN_LIMIT",
  );
  requireReceiveCapacity({ ...empty, entries: 8187 }, id);
  expect(() => requireReceiveCapacity({ ...empty, entries: 8188 }, id)).toThrow(
    "RECEIVE_SCAN_LIMIT",
  );
});

it("old held missing namespace reserves directory/file headroom until explicit release", () => {
  const old = randomUUID(),
    next = randomUUID(),
    attempt = randomUUID();
  const row = {
    id: old,
    reserved_bytes: "65538",
    attempts: [
      { attemptId: attempt, disposition: "held", reservationBytes: 65538 },
    ],
  } as ImportRow;
  const scan: Scan = {
    bytes: 0,
    entries: 1024,
    files: new Map(Array.from({ length: 1023 }, () => [randomUUID(), []])),
  };
  expect(() => requireReceiveCapacity(scan, next, [row])).toThrow(
    "RECEIVE_SCAN_LIMIT",
  );
  requireReceiveCapacity(scan, next, [
    {
      ...row,
      reserved_bytes: "0",
      attempts: [{ ...row.attempts[0]!, disposition: "released" }],
    },
  ]);
  const partial = { file: `attempt-${attempt}.partial`, size: 0 };
  const existing: Scan = {
    bytes: 0,
    entries: 8184,
    files: new Map([[old, [partial]]]),
  } as Scan;
  // Old partial exists, but its missing archive/receipt/tmp still reserves three new names.
  requireReceiveCapacity(existing, next, [row]);
  expect(() =>
    requireReceiveCapacity({ ...existing, entries: 8185 }, next, [row]),
  ).toThrow("RECEIVE_SCAN_LIMIT");
  const noFiles: Scan = {
    ...existing,
    entries: 8183,
    files: new Map([[old, []]]),
  };
  requireReceiveCapacity(noFiles, next, [row]);
  expect(() =>
    requireReceiveCapacity({ ...noFiles, entries: 8184 }, next, [row]),
  ).toThrow("RECEIVE_SCAN_LIMIT");
});
