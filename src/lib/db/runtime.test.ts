import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isLocalOrigin,
  loadRuntimeConfig,
  readPrivateJson,
  runtimeConfigSchema,
  normalizeRuntimeConfig,
  runtimeConfigFile,
} from "./runtime";

const directories: string[] = [];
afterEach(async () => {
  delete process.env.QUIZFORGE_P2A_CONFIG;
  for (const dir of directories.splice(0))
    await rm(dir, { recursive: true, force: true });
});
describe("P2-A private runtime", () => {
  it("fails closed without its sole environment entry", async () => {
    delete process.env.QUIZFORGE_P2A_CONFIG;
    await expect(loadRuntimeConfig()).rejects.toThrow("STUDIO_UNAVAILABLE");
  });
  it.each([
    "http://localhost:3100",
    "https://127.0.0.1:3100",
    "http://127.0.0.1",
    "http://127.0.0.1:3100/",
    "http://127.0.0.1:0",
    "http://127.0.0.1:80",
    "http://127.0.0.1:1023",
    "http://127.0.0.1:65536",
    "http://127.0.0.1:03100",
  ])("rejects origin %s", (origin) => {
    expect(isLocalOrigin(origin)).toBe(false);
  });
  it("accepts only strict local identity and separates CI server facts", () => {
    const id = "a".repeat(32);
    const config = {
      version: 1,
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
    };
    expect(runtimeConfigSchema.safeParse(config).success).toBe(true);
    const v1 = normalizeRuntimeConfig(config);
    expect(v1.imports.enabled).toBe(false);
    expect(runtimeConfigFile(v1)).toEqual(config);
    const v2 = { ...config, version: 2, imports: { enabled: true } };
    expect(runtimeConfigFile(normalizeRuntimeConfig(v2))).toEqual(v2);
    expect(
      runtimeConfigSchema.safeParse({ ...config, imports: { enabled: true } })
        .success,
    ).toBe(false);
    expect(runtimeConfigSchema.safeParse({ ...v2, imports: {} }).success).toBe(
      false,
    );
    expect(
      runtimeConfigSchema.safeParse({ ...config, extra: true }).success,
    ).toBe(false);
    expect(
      runtimeConfigSchema.safeParse({
        ...config,
        server: { ...config.server, port: 5432, address: "172.18.0.2" },
      }).success,
    ).toBe(false);
    expect(
      runtimeConfigSchema.safeParse({
        ...config,
        purpose: "ci",
        server: { ...config.server, port: 5432, address: "172.18.0.2" },
      }).success,
    ).toBe(true);
    expect(
      runtimeConfigSchema.safeParse({
        ...config,
        database: { ...config.database, host: "172.18.0.2" },
      }).success,
    ).toBe(false);
  });
  it("rejects public permissions, symlinks and paths outside the private root", async () => {
    const base = path.join(process.cwd(), ".cache", "p2a");
    await mkdir(base, { recursive: true, mode: 0o700 });
    const dir = path.join(base, randomBytes(16).toString("hex"));
    directories.push(dir);
    await mkdir(dir, { mode: 0o700 });
    const file = path.join(dir, "config.json");
    await writeFile(file, "{}", { mode: 0o600, flag: "wx" });
    expect(await readPrivateJson(file)).toEqual({});
    await chmod(file, 0o644);
    await expect(readPrivateJson(file)).rejects.toThrow("STUDIO_UNAVAILABLE");
    await chmod(file, 0o600);
    const oversized = path.join(dir, "oversized.json");
    await writeFile(oversized, " ".repeat(16_385), { flag: "wx", mode: 0o600 });
    await expect(readPrivateJson(oversized)).rejects.toThrow(
      "STUDIO_UNAVAILABLE",
    );
    const fifo = path.join(dir, "pipe.json");
    await promisify(execFile)("mkfifo", [fifo]);
    await chmod(fifo, 0o600);
    await expect(readPrivateJson(fifo)).rejects.toThrow("STUDIO_UNAVAILABLE");
    const link = path.join(dir, "link.json");
    await symlink(file, link);
    await expect(readPrivateJson(link)).rejects.toThrow();
    await expect(readPrivateJson("/tmp/runtime.json")).rejects.toThrow(
      "STUDIO_UNAVAILABLE",
    );
    await chmod(dir, 0o755);
    await expect(readPrivateJson(file)).rejects.toThrow("STUDIO_UNAVAILABLE");
  });
});
