import "server-only";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export class StudioUnavailableError extends Error {
  readonly code = "STUDIO_UNAVAILABLE";
  constructor() {
    super("STUDIO_UNAVAILABLE");
    this.name = "StudioUnavailableError";
  }
}

export function isLocalOrigin(value: string): boolean {
  const port = Number(value.split(":").at(-1));
  return (
    /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.test(value) &&
    port >= 1024 &&
    port <= 65535
  );
}
const identifier = z.string().regex(/^qf_(app|owner|db)_[a-f0-9]{32}$/);
const runtimeFields = {
  profile: z.literal("local-http-p2a"),
  purpose: z.enum(["test", "demo", "ci"]),
  origin: z.string().refine(isLocalOrigin),
  instanceId: z.string().regex(/^[a-f0-9]{32}$/),
  database: z.strictObject({
    host: z.literal("127.0.0.1"),
    port: z
      .number()
      .int()
      .min(1024)
      .max(65535)
      .refine((p) => p !== 5432),
    name: identifier,
    user: identifier,
    password: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  }),
  server: z.strictObject({
    version: z.literal(180004),
    address: z.string().refine((s) => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(s)),
    port: z.number().int().min(1).max(65535),
  }),
};
export const runtimeConfigSchema = z
  .discriminatedUnion("version", [
    z.strictObject({ version: z.literal(1), ...runtimeFields }),
    z.strictObject({
      version: z.literal(2),
      ...runtimeFields,
      imports: z.strictObject({ enabled: z.boolean() }),
    }),
  ])
  .superRefine((c, ctx) => {
    if (
      c.database.name !== `qf_db_${c.instanceId}` ||
      c.database.user !== `qf_app_${c.instanceId}`
    )
      ctx.addIssue({ code: "custom", message: "Invalid identity" });
    if (
      c.purpose !== "ci" &&
      (c.server.address !== "127.0.0.1" || c.server.port !== c.database.port)
    )
      ctx.addIssue({ code: "custom", message: "Invalid local server" });
  });
export type P2aRuntimeFile = z.infer<typeof runtimeConfigSchema>;
export type P2aRuntimeConfig = P2aRuntimeFile & {
  imports: { enabled: boolean };
};
export function normalizeRuntimeConfig(input: unknown): P2aRuntimeConfig {
  const file = runtimeConfigSchema.parse(input);
  return {
    ...file,
    imports: file.version === 1 ? { enabled: false } : file.imports,
  };
}
/** Internal normalized v1 never leaks its added field into a version 1 file. */
export function runtimeConfigFile(config: P2aRuntimeConfig): P2aRuntimeFile {
  if (config.version === 1) {
    if (config.imports.enabled !== false) throw new StudioUnavailableError();
    const { imports: _imports, ...file } = config;
    void _imports;
    return runtimeConfigSchema.parse(file);
  }
  return runtimeConfigSchema.parse(config);
}

// Every ancestor below this worktree's private instance root must be a real 0700 directory.
export async function readPrivateJson(
  file: string,
  root = process.cwd(),
): Promise<unknown> {
  if (!path.isAbsolute(file)) throw new StudioUnavailableError();
  const base = path.join(root, ".cache", "p2a");
  const relative = path.relative(base, file);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative.split(path.sep).length !== 2
  )
    throw new StudioUnavailableError();
  const instanceDir = path.dirname(file);
  for (const dir of [base, instanceDir]) {
    const stat = await lstat(dir);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o777) !== 0o700 ||
      stat.uid !== process.getuid?.()
    )
      throw new StudioUnavailableError();
  }
  if ((await realpath(instanceDir)) !== instanceDir)
    throw new StudioUnavailableError();
  const handle = await open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.uid !== process.getuid?.() ||
      stat.size > 16_384
    )
      throw new StudioUnavailableError();
    // The actual read is bounded too, even if the file grows after fstat.
    const bytes = Buffer.alloc(16_385);
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        total,
        bytes.length - total,
        total,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > 16_384) throw new StudioUnavailableError();
    return JSON.parse(bytes.subarray(0, total).toString("utf8")) as unknown;
  } finally {
    await handle.close();
  }
}

export async function loadRuntimeConfig(): Promise<P2aRuntimeConfig> {
  try {
    const file = process.env.QUIZFORGE_P2A_CONFIG;
    if (!file) throw new StudioUnavailableError();
    const config = normalizeRuntimeConfig(await readPrivateJson(file));
    if (
      path.basename(path.dirname(file)) !== config.instanceId ||
      path.basename(file) !== "runtime.json"
    )
      throw new StudioUnavailableError();
    return config;
  } catch {
    throw new StudioUnavailableError();
  }
}
