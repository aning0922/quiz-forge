import { constants, type BigIntStats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

const SCHEMA = "quizpack-media-deployment.v1" as const;
const MAX_FILE = 16 * 1024 * 1024;
const MAX_TOTAL = 128 * 1024 * 1024;
const MAX_MANIFEST = 2 * 1024 * 1024;
const MAX_FILES = 4096;
const MAX_ENTRIES = 16384;
const MAX_DEPTH = 16;
const SOURCE_DIRECTORIES = [
  "src/features/quizpack/v1",
  "src/features/quizpack/server/media",
  "src/features/quizpack/server/validation",
] as const;
const SOURCE_FIXED_FILES = [
  "src/lib/foundation-json.ts",
  "src/lib/build/media-deployment.ts",
  "package.json",
  "pnpm-lock.yaml",
  "next.config.ts",
] as const;
const ARTIFACT_FIXED_FILES = [
  "routes-manifest.json",
  "build-manifest.json",
  "prerender-manifest.json",
  "required-server-files.json",
  "package.json",
  "BUILD_ID",
] as const;
const DEPENDENCIES = ["zod", "buffer-crc32"] as const;
type Dependency = (typeof DEPENDENCIES)[number];

export interface MediaDeploymentRoots {
  checkoutRoot: string;
  deploymentRoot: string;
}
export interface MediaDeploymentContext {
  deadlineMonotonicMs: number;
  signal?: AbortSignal;
  checkpoint?: () => void;
}
export interface MediaDeploymentFile {
  path: string;
  bytes: number;
  sha256: string;
}
export interface MediaDeploymentSourceFile extends MediaDeploymentFile {
  role: "source" | Dependency;
}
export interface MediaDeploymentManifest extends MediaDeploymentRoots {
  schema: typeof SCHEMA;
  dependencyRoots: Record<Dependency, string>;
  sourceFiles: MediaDeploymentSourceFile[];
  artifactFiles: MediaDeploymentFile[];
  sourceBundleHash: string;
  deploymentId: string;
}
export type MediaDeploymentCode =
  | "CONTEXT_INVALID"
  | "ROOTS_INVALID"
  | "BUILD_INCOMPLETE"
  | "SOURCE_INVALID"
  | "DEPENDENCY_INVALID"
  | "FILE_UNSAFE"
  | "FILE_CHANGED"
  | "LIMIT_EXCEEDED"
  | "MANIFEST_MISSING"
  | "MANIFEST_INVALID"
  | "MANIFEST_MISMATCH"
  | "IO_FAILED"
  | "CHECKPOINT_FAILED"
  | "CANCELLED"
  | "DEADLINE_EXCEEDED";
export interface MediaDeploymentSummary {
  sourceBundleHash: string;
  deploymentId: string;
  sourceFileCount: number;
  artifactFileCount: number;
  totalBytes: number;
}
export type MediaDeploymentResult =
  | { ok: true; committed: boolean; summary: MediaDeploymentSummary }
  | { ok: false; committed: boolean; code: MediaDeploymentCode };

class Failure extends Error {
  constructor(readonly code: MediaDeploymentCode) {
    super(code);
  }
}
function fail(code: MediaDeploymentCode): never {
  throw new Failure(code);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("MANIFEST_INVALID");
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail("MANIFEST_INVALID");
}
function validText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !/[\u0000-\u001f\u007f\\]/.test(value) &&
    Buffer.from(value).toString("utf8") === value
  );
}
function relativePath(value: unknown): value is string {
  return (
    validText(value) &&
    Buffer.byteLength(value) <= 512 &&
    !path.isAbsolute(value) &&
    !/^[a-zA-Z]:/.test(value) &&
    value.split("/").length <= MAX_DEPTH &&
    value
      .split("/")
      .every(
        (part) =>
          part !== "" &&
          part !== "." &&
          part !== ".." &&
          !part.startsWith(".env") &&
          ![
            ".cache",
            ".git",
            "PGDATA",
            "uploads",
            "test-results",
            "playwright-report",
          ].includes(part),
      )
  );
}
function absolutePath(value: unknown): value is string {
  return (
    validText(value) &&
    Buffer.byteLength(value) <= 4096 &&
    path.isAbsolute(value)
  );
}
function digest(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function compareSource(
  a: MediaDeploymentSourceFile,
  b: MediaDeploymentSourceFile,
) {
  return compare(a.role, b.role) || compare(a.path, b.path);
}
function sourcePath(value: string): boolean {
  return (
    (SOURCE_FIXED_FILES as readonly string[]).includes(value) ||
    (SOURCE_DIRECTORIES.some((root) => value.startsWith(root + "/")) &&
      /\.(?:ts|mjs|json|c|h)$/.test(value) &&
      !/\.(?:test|d)\.ts$/.test(value))
  );
}
function artifactPath(value: string): boolean {
  return (
    (ARTIFACT_FIXED_FILES as readonly string[]).includes(value) ||
    (value.startsWith("server/") && /\.(?:js|json)$/.test(value))
  );
}
function dependencyRoot(value: unknown, name: Dependency): value is string {
  return (
    relativePath(value) &&
    new RegExp(`^node_modules/\\.pnpm/[^/]+/node_modules/${name}$`).test(value)
  );
}
function hashes(
  manifest: Omit<MediaDeploymentManifest, "sourceBundleHash" | "deploymentId">,
) {
  return {
    sourceBundleHash: digest(
      JSON.stringify([
        "quizforge/media-source/v1",
        SCHEMA,
        DEPENDENCIES.map((name) => [name, manifest.dependencyRoots[name]]),
        manifest.sourceFiles.map((f) => [f.role, f.path, f.bytes, f.sha256]),
      ]),
    ),
    deploymentId: digest(
      JSON.stringify([
        "quizforge/media-artifacts/v1",
        SCHEMA,
        manifest.checkoutRoot,
        manifest.deploymentRoot,
        manifest.artifactFiles.map((f) => [f.path, f.bytes, f.sha256]),
      ]),
    ),
  };
}

function parseManifest(bytes: Buffer): MediaDeploymentManifest {
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
    );
  } catch {
    fail("MANIFEST_INVALID");
  }
  const input = object(value);
  exactKeys(input, [
    "schema",
    "checkoutRoot",
    "deploymentRoot",
    "dependencyRoots",
    "sourceFiles",
    "artifactFiles",
    "sourceBundleHash",
    "deploymentId",
  ]);
  if (
    input.schema !== SCHEMA ||
    !absolutePath(input.checkoutRoot) ||
    !absolutePath(input.deploymentRoot)
  )
    fail("MANIFEST_INVALID");
  const dependencies = object(input.dependencyRoots);
  exactKeys(dependencies, DEPENDENCIES);
  for (const name of DEPENDENCIES)
    if (!dependencyRoot(dependencies[name], name)) fail("MANIFEST_INVALID");
  if (!Array.isArray(input.sourceFiles) || !Array.isArray(input.artifactFiles))
    fail("MANIFEST_INVALID");
  if (input.sourceFiles.length + input.artifactFiles.length > MAX_FILES)
    fail("LIMIT_EXCEEDED");
  if (input.sourceFiles.length === 0 || input.artifactFiles.length === 0)
    fail("MANIFEST_INVALID");
  let total = 0;
  const entry = (value: unknown, source: boolean) => {
    const f = object(value);
    exactKeys(
      f,
      source
        ? ["role", "path", "bytes", "sha256"]
        : ["path", "bytes", "sha256"],
    );
    if (
      !relativePath(f.path) ||
      !Number.isSafeInteger(f.bytes) ||
      (f.bytes as number) < 0 ||
      typeof f.sha256 !== "string" ||
      f.sha256.length !== 64 ||
      !/^[a-f0-9]{64}$/.test(f.sha256)
    )
      fail("MANIFEST_INVALID");
    if (
      (f.bytes as number) > MAX_FILE ||
      (total += f.bytes as number) > MAX_TOTAL
    )
      fail("LIMIT_EXCEEDED");
    if (source) {
      if (f.role === "source") {
        if (!sourcePath(f.path)) fail("MANIFEST_INVALID");
      } else if (f.role === "zod" || f.role === "buffer-crc32") {
        if (!f.path.startsWith((dependencies[f.role] as string) + "/"))
          fail("MANIFEST_INVALID");
      } else fail("MANIFEST_INVALID");
    } else if (!artifactPath(f.path)) fail("MANIFEST_INVALID");
    return f;
  };
  const sourceFiles = input.sourceFiles.map((f) =>
    entry(f, true),
  ) as unknown as MediaDeploymentSourceFile[];
  const artifactFiles = input.artifactFiles.map((f) =>
    entry(f, false),
  ) as unknown as MediaDeploymentFile[];
  if (
    sourceFiles.some(
      (f, i) => i > 0 && compareSource(sourceFiles[i - 1]!, f) >= 0,
    ) ||
    artifactFiles.some(
      (f, i) => i > 0 && compare(artifactFiles[i - 1]!.path, f.path) >= 0,
    )
  )
    fail("MANIFEST_INVALID");
  for (const key of ["sourceBundleHash", "deploymentId"])
    if (
      typeof input[key] !== "string" ||
      (input[key] as string).length !== 64 ||
      !/^[a-f0-9]{64}$/.test(input[key] as string)
    )
      fail("MANIFEST_INVALID");
  const manifest = input as unknown as MediaDeploymentManifest;
  const expected = hashes(manifest);
  if (
    expected.sourceBundleHash !== manifest.sourceBundleHash ||
    expected.deploymentId !== manifest.deploymentId
  )
    fail("MANIFEST_MISMATCH");
  return manifest;
}

function context(value: MediaDeploymentContext): MediaDeploymentContext {
  if (
    !value ||
    typeof value !== "object" ||
    !Object.hasOwn(value, "deadlineMonotonicMs") ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    Object.keys(value).some(
      (key) => !["deadlineMonotonicMs", "signal", "checkpoint"].includes(key),
    ) ||
    !Number.isFinite(value.deadlineMonotonicMs) ||
    (value.signal !== undefined && !(value.signal instanceof AbortSignal)) ||
    (value.checkpoint !== undefined && typeof value.checkpoint !== "function")
  )
    fail("CONTEXT_INVALID");
  return { ...value };
}
function checkpoint(ctx: MediaDeploymentContext) {
  if (ctx.signal?.aborted) fail("CANCELLED");
  if (performance.now() >= ctx.deadlineMonotonicMs) fail("DEADLINE_EXCEEDED");
  try {
    if (ctx.checkpoint?.() !== undefined) fail("CONTEXT_INVALID");
  } catch (error) {
    if (ctx.signal?.aborted) fail("CANCELLED");
    if (performance.now() >= ctx.deadlineMonotonicMs) fail("DEADLINE_EXCEEDED");
    if (error instanceof Failure) throw error;
    fail("CHECKPOINT_FAILED");
  }
  if (ctx.signal?.aborted) fail("CANCELLED");
  if (performance.now() >= ctx.deadlineMonotonicMs) fail("DEADLINE_EXCEEDED");
}
function same(a: BigIntStats, b: BigIntStats): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  );
}
function owned(stat: BigIntStats): boolean {
  return (
    typeof process.getuid === "function" &&
    stat.uid === BigInt(process.getuid()) &&
    (stat.mode & 0o022n) === 0n
  );
}
async function directory(
  target: string,
  ctx: MediaDeploymentContext,
  privateLeaf = false,
) {
  checkpoint(ctx);
  const s = await lstat(target, { bigint: true });
  checkpoint(ctx);
  if (
    !s.isDirectory() ||
    !owned(s) ||
    (privateLeaf && (s.mode & 0o777n) !== 0o700n)
  )
    fail("FILE_UNSAFE");
  return s;
}
async function ancestors(
  root: string,
  target: string,
  ctx: MediaDeploymentContext,
) {
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) fail("ROOTS_INVALID");
  await directory(root, ctx);
  let current = root;
  for (const part of rel.split(path.sep).slice(0, -1)) {
    if (!part) continue;
    current = path.join(current, part);
    await directory(current, ctx);
  }
}
async function roots(input: MediaDeploymentRoots, ctx: MediaDeploymentContext) {
  if (
    !input ||
    typeof input !== "object" ||
    Object.keys(input).length !== 2 ||
    Object.getOwnPropertySymbols(input).length !== 0 ||
    !Object.hasOwn(input, "checkoutRoot") ||
    !Object.hasOwn(input, "deploymentRoot") ||
    !absolutePath(input.checkoutRoot) ||
    !absolutePath(input.deploymentRoot)
  )
    fail("ROOTS_INVALID");
  for (const root of [input.checkoutRoot, input.deploymentRoot]) {
    checkpoint(ctx);
    try {
      if ((await realpath(root)) !== root) fail("ROOTS_INVALID");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        fail(
          root === input.deploymentRoot ? "BUILD_INCOMPLETE" : "ROOTS_INVALID",
        );
      throw error;
    }
    checkpoint(ctx);
    await directory(root, ctx);
  }
  const rel = path.relative(input.checkoutRoot, input.deploymentRoot);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel))
    fail("ROOTS_INVALID");
  await ancestors(
    input.checkoutRoot,
    path.join(input.deploymentRoot, "anchor"),
    ctx,
  );
  return { ...input };
}
interface Budget {
  entries: number;
  files: number;
  bytes: number;
}
async function readRegular(
  root: string,
  rel: string,
  ctx: MediaDeploymentContext,
  budget?: Budget,
  privateManifest = false,
) {
  if (!privateManifest && !relativePath(rel)) fail("FILE_UNSAFE");
  const target = path.join(root, rel);
  await ancestors(root, target, ctx);
  const before = await lstat(target, { bigint: true });
  checkpoint(ctx);
  if (
    !before.isFile() ||
    !owned(before) ||
    (privateManifest &&
      ((before.mode & 0o777n) !== 0o600n || before.nlink !== 1n))
  )
    fail("FILE_UNSAFE");
  const max = privateManifest ? MAX_MANIFEST : MAX_FILE;
  if (before.size > BigInt(max)) fail("LIMIT_EXCEEDED");
  if (
    budget &&
    (++budget.files > MAX_FILES ||
      (budget.bytes += Number(before.size)) > MAX_TOTAL)
  )
    fail("LIMIT_EXCEEDED");
  let bytes: Buffer;
  const file = await open(
    target,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    checkpoint(ctx);
    if (!same(before, await file.stat({ bigint: true }))) fail("FILE_CHANGED");
    checkpoint(ctx);
    bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const result = await file.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      checkpoint(ctx);
      if (result.bytesRead === 0) fail("FILE_CHANGED");
      offset += result.bytesRead;
    }
    if (!same(before, await file.stat({ bigint: true }))) fail("FILE_CHANGED");
    checkpoint(ctx);
    if (!same(before, await lstat(target, { bigint: true })))
      fail("FILE_CHANGED");
    checkpoint(ctx);
    await ancestors(root, target, ctx);
  } finally {
    await file.close();
  }
  checkpoint(ctx);
  return {
    bytes,
    entry: { path: rel, bytes: bytes.length, sha256: digest(bytes) },
  };
}
async function walk(
  root: string,
  rel: string,
  ctx: MediaDeploymentContext,
  budget: Budget,
  visit: (rel: string) => Promise<void>,
) {
  if (!relativePath(rel)) fail("FILE_UNSAFE");
  const target = path.join(root, rel);
  await ancestors(root, target, ctx);
  const before = await directory(target, ctx);
  const dir = await opendir(target, { bufferSize: 16 });
  try {
    checkpoint(ctx);
    for (;;) {
      const entry = await dir.read();
      checkpoint(ctx);
      if (!entry) break;
      if (++budget.entries > MAX_ENTRIES) fail("LIMIT_EXCEEDED");
      const name = rel + "/" + entry.name;
      if (!relativePath(name) || entry.isSymbolicLink()) fail("FILE_UNSAFE");
      if (entry.isDirectory()) await walk(root, name, ctx, budget, visit);
      else if (entry.isFile()) await visit(name);
      else fail("FILE_UNSAFE");
    }
    if (!same(before, await lstat(target, { bigint: true })))
      fail("FILE_CHANGED");
    checkpoint(ctx);
  } finally {
    await dir.close();
  }
  checkpoint(ctx);
}
function packageIdentity(bytes: Buffer): {
  name: unknown;
  version: unknown;
  dependencies: Record<string, unknown>;
} {
  try {
    const input = object(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    return {
      name: input.name,
      version: input.version,
      dependencies:
        input.dependencies === undefined ? {} : object(input.dependencies),
    };
  } catch {
    fail("DEPENDENCY_INVALID");
  }
}
async function snapshot(
  bound: MediaDeploymentRoots,
  ctx: MediaDeploymentContext,
): Promise<MediaDeploymentManifest> {
  const budget = { entries: 0, files: 0, bytes: 0 };
  const sourceFiles: MediaDeploymentSourceFile[] = [];
  const artifactFiles: MediaDeploymentFile[] = [];
  let declared: Record<string, unknown> = {};
  for (const rel of SOURCE_FIXED_FILES) {
    const result = await readRegular(bound.checkoutRoot, rel, ctx, budget);
    sourceFiles.push({ role: "source", ...result.entry });
    if (rel === "package.json")
      declared = packageIdentity(result.bytes).dependencies;
  }
  for (const rel of SOURCE_DIRECTORIES)
    await walk(bound.checkoutRoot, rel, ctx, budget, async (file) => {
      if (sourcePath(file))
        sourceFiles.push({
          role: "source",
          ...(await readRegular(bound.checkoutRoot, file, ctx, budget)).entry,
        });
    });
  const dependencyRoots = {} as Record<Dependency, string>;
  const require = createRequire(path.join(bound.checkoutRoot, "package.json"));
  for (const name of DEPENDENCIES) {
    const entry = path.join(bound.checkoutRoot, "node_modules", name);
    await ancestors(bound.checkoutRoot, entry, ctx);
    const link = await lstat(entry, { bigint: true });
    checkpoint(ctx);
    if (
      typeof process.getuid !== "function" ||
      !link.isSymbolicLink() ||
      link.uid !== BigInt(process.getuid())
    )
      fail("DEPENDENCY_INVALID");
    const actual = await realpath(entry);
    checkpoint(ctx);
    const rel = path
      .relative(bound.checkoutRoot, actual)
      .split(path.sep)
      .join("/");
    if (!dependencyRoot(rel, name)) fail("DEPENDENCY_INVALID");
    await ancestors(bound.checkoutRoot, path.join(actual, "package.json"), ctx);
    let packageBytes: Buffer | undefined;
    const packageFiles = new Set<string>();
    await walk(bound.checkoutRoot, rel, ctx, budget, async (file) => {
      // Node may execute or read nonstandard extensions. Bind every regular
      // file in these two fixed package roots, including dependency data.
      const read = await readRegular(bound.checkoutRoot, file, ctx, budget);
      sourceFiles.push({ role: name, ...read.entry });
      packageFiles.add(file);
      if (file === rel + "/package.json") packageBytes = read.bytes;
    });
    if (!packageBytes) fail("DEPENDENCY_INVALID");
    const identity = packageIdentity(packageBytes);
    if (
      identity.name !== name ||
      typeof identity.version !== "string" ||
      identity.version !== declared[name]
    )
      fail("DEPENDENCY_INVALID");
    // Only these two already-validated package roots are resolved. This Node
    // resolver is synchronous; the deadline is checked after it returns.
    const resolved = require.resolve(name);
    checkpoint(ctx);
    const relativeEntry = path.relative(actual, await realpath(resolved));
    checkpoint(ctx);
    if (
      !relativeEntry ||
      relativeEntry.startsWith("..") ||
      path.isAbsolute(relativeEntry) ||
      !packageFiles.has(rel + "/" + relativeEntry.split(path.sep).join("/"))
    )
      fail("DEPENDENCY_INVALID");
    dependencyRoots[name] = rel;
    if (
      !same(link, await lstat(entry, { bigint: true })) ||
      (await realpath(entry)) !== actual
    )
      fail("FILE_CHANGED");
    checkpoint(ctx);
  }
  for (const rel of ARTIFACT_FIXED_FILES) {
    const result = await readRegular(bound.deploymentRoot, rel, ctx, budget);
    if (rel === "BUILD_ID") {
      const id = result.bytes.toString("utf8");
      if (id.trim() !== id || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
        fail("BUILD_INCOMPLETE");
    }
    artifactFiles.push(result.entry);
  }
  await walk(bound.deploymentRoot, "server", ctx, budget, async (file) => {
    if (artifactPath(file))
      artifactFiles.push(
        (await readRegular(bound.deploymentRoot, file, ctx, budget)).entry,
      );
    // Known non-executable Next render/source-map outputs are not this code binding.
    else if (!/\.(?:html|rsc|meta|map|txt|body)$/.test(file))
      fail("FILE_UNSAFE");
  });
  if (
    !artifactFiles.some(
      (f) => f.path.startsWith("server/") && f.path.endsWith(".js"),
    )
  )
    fail("BUILD_INCOMPLETE");
  sourceFiles.sort(compareSource);
  artifactFiles.sort((a, b) => compare(a.path, b.path));
  const result = {
    schema: SCHEMA,
    ...bound,
    dependencyRoots,
    sourceFiles,
    artifactFiles,
  };
  checkpoint(ctx);
  return { ...result, ...hashes(result) };
}

const MANIFEST_RELATIVE = ".cache/quizpack-media-runtime/deployment.json";
async function manifestDirectory(
  root: string,
  ctx: MediaDeploymentContext,
  prepare: boolean,
) {
  let current = root;
  for (const part of [".cache", "quizpack-media-runtime"]) {
    current = path.join(current, part);
    if (prepare) {
      checkpoint(ctx);
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      checkpoint(ctx);
    }
    await directory(current, ctx, part === "quizpack-media-runtime");
  }
  return current;
}
async function save(
  root: string,
  manifest: MediaDeploymentManifest,
  ctx: MediaDeploymentContext,
  state: { committed: boolean },
) {
  const bytes = Buffer.from(JSON.stringify(manifest));
  if (bytes.length > MAX_MANIFEST) fail("LIMIT_EXCEEDED");
  const leaf = await manifestDirectory(root, ctx, true);
  const target = path.join(root, MANIFEST_RELATIVE);
  let before: BigIntStats | undefined;
  try {
    before = await lstat(target, { bigint: true });
    checkpoint(ctx);
    if (
      !before.isFile() ||
      !owned(before) ||
      (before.mode & 0o777n) !== 0o600n ||
      before.nlink !== 1n
    )
      fail("FILE_UNSAFE");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = path.join(leaf, `.deployment-${randomUUID()}.tmp`);
  let temporaryExists = false;
  try {
    checkpoint(ctx);
    const file = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      0o600,
    );
    temporaryExists = true;
    try {
      checkpoint(ctx);
      const stat = await file.stat({ bigint: true });
      checkpoint(ctx);
      if (!owned(stat) || (stat.mode & 0o777n) !== 0o600n || stat.nlink !== 1n)
        fail("FILE_UNSAFE");
      await file.writeFile(bytes);
      checkpoint(ctx);
      await file.sync();
      checkpoint(ctx);
    } finally {
      await file.close();
    }
    checkpoint(ctx);
    await manifestDirectory(root, ctx, false);
    let now: BigIntStats | undefined;
    try {
      now = await lstat(target, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    checkpoint(ctx);
    if (before ? !now || !same(before, now) : now !== undefined)
      fail("FILE_CHANGED");
    await rename(temporary, target);
    state.committed = true;
    temporaryExists = false;
    checkpoint(ctx);
    const dir = await open(
      leaf,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await dir.sync();
      checkpoint(ctx);
    } finally {
      await dir.close();
    }
    checkpoint(ctx);
  } finally {
    if (temporaryExists) await unlink(temporary);
  }
}
function summary(manifest: MediaDeploymentManifest): MediaDeploymentSummary {
  return {
    sourceBundleHash: manifest.sourceBundleHash,
    deploymentId: manifest.deploymentId,
    sourceFileCount: manifest.sourceFiles.length,
    artifactFileCount: manifest.artifactFiles.length,
    totalBytes: [...manifest.sourceFiles, ...manifest.artifactFiles].reduce(
      (sum, file) => sum + file.bytes,
      0,
    ),
  };
}
function code(error: unknown): MediaDeploymentCode {
  return error instanceof Failure ? error.code : "IO_FAILED";
}
function finalCode(
  error: unknown,
  ctx?: MediaDeploymentContext,
): MediaDeploymentCode {
  if (ctx?.signal?.aborted) return "CANCELLED";
  if (ctx && performance.now() >= ctx.deadlineMonotonicMs)
    return "DEADLINE_EXCEEDED";
  return code(error);
}

// Trusted roots only: callers derive these from build-time constants or the
// closed build CLI. No request/environment root selector exists here. All IO is
// awaited, including close/cleanup; bounded bytes and deadline checkpoints are
// not a hard-real-time guarantee against a stalled filesystem.
export async function buildMediaDeployment(
  input: MediaDeploymentRoots,
  supplied: MediaDeploymentContext,
): Promise<MediaDeploymentResult> {
  const state = { committed: false };
  let ctx: MediaDeploymentContext | undefined;
  try {
    ctx = context(supplied);
    checkpoint(ctx);
    const bound = await roots(input, ctx);
    const manifest = await snapshot(bound, ctx);
    await save(bound.checkoutRoot, manifest, ctx, state);
    checkpoint(ctx);
    return { ok: true, committed: state.committed, summary: summary(manifest) };
  } catch (error) {
    return {
      ok: false,
      committed: state.committed,
      code: finalCode(error, ctx),
    };
  }
}
export async function verifyMediaDeployment(
  input: MediaDeploymentRoots,
  supplied: MediaDeploymentContext,
): Promise<MediaDeploymentResult> {
  let ctx: MediaDeploymentContext | undefined;
  try {
    ctx = context(supplied);
    checkpoint(ctx);
    const bound = await roots(input, ctx);
    let bytes: Buffer;
    try {
      await manifestDirectory(bound.checkoutRoot, ctx, false);
      bytes = (
        await readRegular(
          bound.checkoutRoot,
          MANIFEST_RELATIVE,
          ctx,
          undefined,
          true,
        )
      ).bytes;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        fail("MANIFEST_MISSING");
      throw error;
    }
    const expected = parseManifest(bytes);
    checkpoint(ctx);
    if (
      expected.checkoutRoot !== bound.checkoutRoot ||
      expected.deploymentRoot !== bound.deploymentRoot
    )
      fail("MANIFEST_MISMATCH");
    const actual = await snapshot(bound, ctx);
    if (
      expected.sourceBundleHash !== actual.sourceBundleHash ||
      expected.deploymentId !== actual.deploymentId
    )
      fail("MANIFEST_MISMATCH");
    checkpoint(ctx);
    return { ok: true, committed: false, summary: summary(actual) };
  } catch (error) {
    return { ok: false, committed: false, code: finalCode(error, ctx) };
  }
}
