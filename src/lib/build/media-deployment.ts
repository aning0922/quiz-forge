import { constants, type BigIntStats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  readlink,
  rename,
  unlink,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

const SCHEMA = "quizpack-media-deployment.v1" as const;
const MAX_FILE = 16 * 1024 * 1024;
const MAX_SHARP_FILE = 32 * 1024 * 1024;
const MAX_TOTAL = 128 * 1024 * 1024;
const MAX_MANIFEST = 2 * 1024 * 1024;
const MAX_FILES = 4096;
const MAX_ENTRIES = 16384;
const MAX_DEPTH = 16;
const SOURCE_DIRECTORIES = [
  "src/features/quizpack/v1",
  "src/features/quizpack/package",
  "src/features/quizpack/content",
  "src/features/quizpack/server/media",
  "src/features/quizpack/server/validation",
] as const;
const SOURCE_FIXED_FILES = [
  "src/lib/foundation-json.ts",
  "src/lib/assessment-contract/primitives.ts",
  "src/lib/assessment-contract/scoring-v1.ts",
  "src/lib/json/canonical.ts",
  "src/lib/build/media-deployment.ts",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
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
const ARGON2_PACKAGES = [
  { name: "argon2", version: "0.44.0", entry: "argon2.cjs" },
  { name: "@phc/format", version: "1.0.0", entry: "index.js" },
  { name: "node-gyp-build", version: "4.8.4", entry: "index.js" },
] as const;
type AliasKind = "sharp" | "argon2";
type AliasRoots = { sharp: string; argon2?: string };
const ARGON2_SELECTION_ENV = [
  "ARGON2_PREBUILD",
  "PREBUILDS_ONLY",
  "npm_config_arch",
  "npm_config_platform",
  "LIBC",
  "ARM_VERSION",
  "ELECTRON_RUN_AS_NODE",
] as const;

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
  role: "source" | Dependency | "sharp-runtime" | "argon2-runtime";
}
export interface MediaDeploymentArtifactAlias {
  path: string;
  targetRoot: string;
  readlinkSha256: string;
}
export interface MediaDeploymentSharpRuntime {
  platform: "darwin-arm64" | "linux-x64";
  packageRoots: { name: string; root: string }[];
}
export interface MediaDeploymentArgon2Runtime {
  platform: MediaDeploymentSharpRuntime["platform"];
  packageRoots: { name: string; root: string; entry: string }[];
  native: MediaDeploymentFile;
  filesHash: string;
}
export interface MediaDeploymentManifest extends MediaDeploymentRoots {
  schema: typeof SCHEMA;
  dependencyRoots: Record<Dependency, string>;
  sharpRuntime: MediaDeploymentSharpRuntime;
  argon2Runtime: MediaDeploymentArgon2Runtime | null;
  sourceFiles: MediaDeploymentSourceFile[];
  artifactFiles: MediaDeploymentFile[];
  artifactAliases: MediaDeploymentArtifactAlias[];
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

export interface MediaDeploymentHardeningSummary {
  checkedFiles: number;
  checkedDirectories: number;
  changedFiles: number;
  changedDirectories: number;
}
export type MediaDeploymentHardeningResult =
  | { ok: true; summary: MediaDeploymentHardeningSummary }
  | {
      ok: false;
      code: MediaDeploymentCode;
      summary: MediaDeploymentHardeningSummary;
    };

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
function dependencyRoot(value: unknown, name: string): value is string {
  return (
    relativePath(value) &&
    new RegExp(
      `^node_modules/\\.pnpm/[^/]+/node_modules/${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    ).test(value)
  );
}
function argon2Root(name: string, version: string) {
  return `node_modules/.pnpm/${name.replace("/", "+")}@${version}/node_modules/${name}`;
}
function argon2Native(platform: MediaDeploymentSharpRuntime["platform"]) {
  return platform === "darwin-arm64"
    ? "prebuilds/darwin-arm64/argon2.armv8.glibc.node"
    : "prebuilds/linux-x64/argon2.glibc.node";
}
function artifactAliasKind(rel: string, error: MediaDeploymentCode): AliasKind {
  const match = /^node_modules\/(sharp|argon2)-[a-f0-9]{16}$/.exec(rel);
  if (!match) fail(error);
  return match[1] as AliasKind;
}
function aliasRoots(
  sharp: MediaDeploymentSharpRuntime,
  argon2: MediaDeploymentArgon2Runtime | null,
): AliasRoots {
  return {
    sharp: sharp.packageRoots[0]!.root,
    ...(argon2 ? { argon2: argon2.packageRoots[0]!.root } : {}),
  };
}
function sharpNames(platform: string): string[] {
  if (platform !== "darwin-arm64" && platform !== "linux-x64")
    fail("DEPENDENCY_INVALID");
  return [
    "sharp",
    "@img/colour",
    "detect-libc",
    "semver",
    `@img/sharp-${platform}`,
    `@img/sharp-libvips-${platform}`,
  ];
}
function sharpPlatform(): MediaDeploymentSharpRuntime["platform"] {
  const platform = `${process.platform}-${process.arch}`;
  sharpNames(platform);
  if (platform === "linux-x64") {
    // Only this one fixed, actual Node report header is inspected. Missing or
    // malformed libc evidence fails closed, including musl with glibc packages.
    let version: unknown;
    try {
      const report = process.report.getReport() as unknown as {
        header?: { glibcVersionRuntime?: unknown };
      };
      version = report.header?.glibcVersionRuntime;
    } catch {
      fail("DEPENDENCY_INVALID");
    }
    if (
      typeof version !== "string" ||
      version.length > 32 ||
      !/^\d{1,3}\.\d{1,3}(?:\.\d{1,3})?$/.test(version)
    )
      fail("DEPENDENCY_INVALID");
  }
  return platform as MediaDeploymentSharpRuntime["platform"];
}
function argon2FilesHash(files: MediaDeploymentFile[]) {
  return digest(JSON.stringify(files.map((f) => [f.path, f.bytes, f.sha256])));
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
        [
          manifest.sharpRuntime.platform,
          manifest.sharpRuntime.packageRoots.map((p) => [p.name, p.root]),
        ],
        manifest.argon2Runtime && [
          manifest.argon2Runtime.platform,
          manifest.argon2Runtime.packageRoots.map((p) => [
            p.name,
            p.root,
            p.entry,
          ]),
          manifest.argon2Runtime.native,
          manifest.argon2Runtime.filesHash,
        ],
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
        manifest.artifactAliases.map((a) => [
          a.path,
          a.targetRoot,
          a.readlinkSha256,
        ]),
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
    "sharpRuntime",
    "argon2Runtime",
    "sourceFiles",
    "artifactFiles",
    "artifactAliases",
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
  const sharp = object(input.sharpRuntime);
  exactKeys(sharp, ["platform", "packageRoots"]);
  if (sharp.platform !== "darwin-arm64" && sharp.platform !== "linux-x64")
    fail("MANIFEST_INVALID");
  const names = sharpNames(sharp.platform);
  if (
    !Array.isArray(sharp.packageRoots) ||
    sharp.packageRoots.length !== names.length
  )
    fail("MANIFEST_INVALID");
  const packageRoots = sharp.packageRoots.map((value, i) => {
    const p = object(value);
    exactKeys(p, ["name", "root"]);
    if (p.name !== names[i] || !dependencyRoot(p.root, names[i]!))
      fail("MANIFEST_INVALID");
    return p as unknown as { name: string; root: string };
  });
  let argon2Runtime: MediaDeploymentArgon2Runtime | null = null;
  if (input.argon2Runtime !== null) {
    const a = object(input.argon2Runtime);
    exactKeys(a, ["platform", "packageRoots", "native", "filesHash"]);
    if (
      a.platform !== sharp.platform ||
      !Array.isArray(a.packageRoots) ||
      a.packageRoots.length !== ARGON2_PACKAGES.length
    )
      fail("MANIFEST_INVALID");
    const roots = a.packageRoots.map((value, i) => {
      const p = object(value),
        fixed = ARGON2_PACKAGES[i]!;
      exactKeys(p, ["name", "root", "entry"]);
      const root = argon2Root(fixed.name, fixed.version);
      if (
        p.name !== fixed.name ||
        p.root !== root ||
        p.entry !== root + "/" + fixed.entry
      )
        fail("MANIFEST_INVALID");
      return p as unknown as { name: string; root: string; entry: string };
    });
    const native = object(a.native);
    exactKeys(native, ["path", "bytes", "sha256"]);
    if (
      native.path !== roots[0]!.root + "/" + argon2Native(sharp.platform) ||
      !Number.isSafeInteger(native.bytes) ||
      (native.bytes as number) <= 0 ||
      (native.bytes as number) > MAX_FILE ||
      typeof native.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(native.sha256)
    )
      fail("MANIFEST_INVALID");
    if (typeof a.filesHash !== "string" || !/^[a-f0-9]{64}$/.test(a.filesHash))
      fail("MANIFEST_INVALID");
    argon2Runtime = {
      platform: sharp.platform,
      packageRoots: roots,
      native: native as unknown as MediaDeploymentFile,
      filesHash: a.filesHash,
    };
  }
  const acceptedRoots: AliasRoots = {
    sharp: packageRoots[0]!.root,
    ...(argon2Runtime ? { argon2: argon2Runtime.packageRoots[0]!.root } : {}),
  };
  if (!Array.isArray(input.artifactAliases) || input.artifactAliases.length > 2)
    fail("MANIFEST_INVALID");
  const aliasKinds = new Set<AliasKind>();
  for (const [i, value] of input.artifactAliases.entries()) {
    const a = object(value);
    exactKeys(a, ["path", "targetRoot", "readlinkSha256"]);
    if (typeof a.path !== "string") fail("MANIFEST_INVALID");
    const kind = artifactAliasKind(a.path, "MANIFEST_INVALID");
    if (
      aliasKinds.has(kind) ||
      !acceptedRoots[kind] ||
      a.targetRoot !== acceptedRoots[kind] ||
      (i > 0 &&
        compare(
          (input.artifactAliases[i - 1] as MediaDeploymentArtifactAlias).path,
          a.path,
        ) >= 0) ||
      typeof a.readlinkSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(a.readlinkSha256)
    )
      fail("MANIFEST_INVALID");
    aliasKinds.add(kind);
  }
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
      (f.bytes as number) >
        (source && f.role === "sharp-runtime" ? MAX_SHARP_FILE : MAX_FILE) ||
      (total += f.bytes as number) > MAX_TOTAL
    )
      fail("LIMIT_EXCEEDED");
    if (source) {
      if (f.role === "source") {
        if (!sourcePath(f.path)) fail("MANIFEST_INVALID");
      } else if (f.role === "zod" || f.role === "buffer-crc32") {
        if (!f.path.startsWith((dependencies[f.role] as string) + "/"))
          fail("MANIFEST_INVALID");
      } else if (f.role === "sharp-runtime") {
        if (
          !packageRoots.some((p) => (f.path as string).startsWith(p.root + "/"))
        )
          fail("MANIFEST_INVALID");
      } else if (f.role === "argon2-runtime") {
        if (
          !argon2Runtime ||
          !argon2Runtime.packageRoots.some((p) =>
            (f.path as string).startsWith(p.root + "/"),
          )
        )
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
  if (argon2Runtime) {
    const files = sourceFiles.filter((f) => f.role === "argon2-runtime");
    if (
      argon2FilesHash(files) !== argon2Runtime.filesHash ||
      !files.some(
        (f) =>
          f.path === argon2Runtime.native.path &&
          f.bytes === argon2Runtime.native.bytes &&
          f.sha256 === argon2Runtime.native.sha256,
      )
    )
      fail("MANIFEST_INVALID");
  }
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
    (stat.mode & BigInt(0o022)) === BigInt(0)
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
    (privateLeaf && (s.mode & BigInt(0o777)) !== BigInt(0o700))
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
  maxFile = MAX_FILE,
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
      ((before.mode & BigInt(0o777)) !== BigInt(0o600) ||
        before.nlink !== BigInt(1)))
  )
    fail("FILE_UNSAFE");
  const max = privateManifest ? MAX_MANIFEST : maxFile;
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
  exports: unknown;
} {
  try {
    const input = object(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    return {
      name: input.name,
      version: input.version,
      exports: input.exports,
      dependencies:
        input.dependencies === undefined ? {} : object(input.dependencies),
    };
  } catch {
    fail("DEPENDENCY_INVALID");
  }
}
async function sharpMapping(
  bound: MediaDeploymentRoots,
  ctx: MediaDeploymentContext,
): Promise<MediaDeploymentSharpRuntime> {
  const platform = sharpPlatform();
  const names = sharpNames(platform);
  const packageRoots: MediaDeploymentSharpRuntime["packageRoots"] = [];
  let sharpRoot = "";
  const declaration = packageIdentity(
    (await readRegular(bound.checkoutRoot, "package.json", ctx)).bytes,
  ).dependencies.sharp;
  if (declaration !== "0.35.5") fail("DEPENDENCY_INVALID");
  for (const name of names) {
    // The six fixed sharpNames entries are checked against their actual
    // installed roots below; this is not a build-time checkout-wide glob.
    const entry =
      name === "sharp"
        ? path.join(bound.checkoutRoot, "node_modules/sharp")
        : path.join(/* turbopackIgnore: true */ path.dirname(sharpRoot), name);
    await ancestors(bound.checkoutRoot, entry, ctx);
    const before = await lstat(entry, { bigint: true });
    checkpoint(ctx);
    if (!before.isSymbolicLink() || before.uid !== BigInt(process.getuid!()))
      fail("DEPENDENCY_INVALID");
    const actual = await realpath(entry);
    checkpoint(ctx);
    const rel = path
      .relative(bound.checkoutRoot, actual)
      .split(path.sep)
      .join("/");
    if (!dependencyRoot(rel, name)) fail("DEPENDENCY_INVALID");
    const metadata = await readRegular(
      bound.checkoutRoot,
      rel + "/package.json",
      ctx,
      undefined,
      false,
      64 * 1024,
    );
    const identity = packageIdentity(metadata.bytes);
    if (
      identity.name !== name ||
      typeof identity.version !== "string" ||
      identity.version.length > 80 ||
      !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(identity.version) ||
      (name === "sharp" && identity.version !== declaration)
    )
      fail("DEPENDENCY_INVALID");
    if (
      !same(before, await lstat(entry, { bigint: true })) ||
      (await realpath(entry)) !== actual
    )
      fail("FILE_CHANGED");
    checkpoint(ctx);
    packageRoots.push({ name, root: rel });
    if (name === "sharp") sharpRoot = actual;
  }
  // The native addon's Node query and its first loader-relative libvips lookup
  // use the addon's own sibling edge, not the edge beside the sharp JS package.
  const native = packageRoots[4]!;
  const libvips = packageRoots[5]!;
  const nativeRoot = path.join(bound.checkoutRoot, native.root);
  const libvipsRoot = path.join(bound.checkoutRoot, libvips.root);
  const edge = path.join(path.dirname(nativeRoot), `sharp-libvips-${platform}`);
  await ancestors(bound.checkoutRoot, edge, ctx);
  const edgeBefore = await lstat(edge, { bigint: true });
  checkpoint(ctx);
  if (
    !edgeBefore.isSymbolicLink() ||
    edgeBefore.uid !== BigInt(process.getuid!()) ||
    (await realpath(edge)) !== libvipsRoot
  )
    fail("DEPENDENCY_INVALID");
  checkpoint(ctx);
  const nativeFile = `lib/sharp-${platform}-0.35.5.node`;
  const libraryFile =
    platform === "darwin-arm64"
      ? "libvips-cpp.8.18.7.dylib"
      : "libvips-cpp.so.8.18.7";
  const nativeMetadata = packageIdentity(
    (
      await readRegular(
        bound.checkoutRoot,
        native.root + "/package.json",
        ctx,
        undefined,
        false,
        64 * 1024,
      )
    ).bytes,
  );
  const libMetadata = packageIdentity(
    (
      await readRegular(
        bound.checkoutRoot,
        libvips.root + "/package.json",
        ctx,
        undefined,
        false,
        64 * 1024,
      )
    ).bytes,
  );
  if (
    object(nativeMetadata.exports)["./sharp.node"] !== "./index.cjs" ||
    object(libMetadata.exports)["./binary"] !== `./lib/${libraryFile}`
  )
    fail("DEPENDENCY_INVALID");
  const index = (
    await readRegular(
      bound.checkoutRoot,
      native.root + "/index.cjs",
      ctx,
      undefined,
      false,
      64 * 1024,
    )
  ).bytes.toString("utf8");
  if (
    index.trim() !==
    `try { require.resolve('${libvips.name}/binary'); } catch {}\nmodule.exports = require('./${nativeFile}');`
  )
    fail("DEPENDENCY_INVALID");
  // Mapping needs existence/identity only. The package walk below hashes these
  // complete bytes once against the shared source/artifact data budget.
  for (const rel of [
    native.root + "/" + nativeFile,
    libvips.root + "/lib/" + libraryFile,
  ]) {
    const target = path.join(bound.checkoutRoot, rel);
    await ancestors(bound.checkoutRoot, target, ctx);
    const before = await lstat(target, { bigint: true });
    checkpoint(ctx);
    if (
      !before.isFile() ||
      !owned(before) ||
      before.size > BigInt(MAX_SHARP_FILE)
    )
      fail("FILE_UNSAFE");
    const fd = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      if (
        !same(before, await fd.stat({ bigint: true })) ||
        !same(before, await lstat(target, { bigint: true }))
      )
        fail("FILE_CHANGED");
      checkpoint(ctx);
    } finally {
      await fd.close();
    }
    checkpoint(ctx);
  }
  const expectedLibrary = path.join(libvipsRoot, "lib", libraryFile);
  const firstLoaderCandidate = path.resolve(
    nativeRoot,
    "lib",
    `../../sharp-libvips-${platform}/lib`,
    libraryFile,
  );
  if ((await realpath(firstLoaderCandidate)) !== expectedLibrary)
    fail("DEPENDENCY_INVALID");
  checkpoint(ctx);
  const require = createRequire(path.join(nativeRoot, "package.json"));
  const queried = require.resolve(`${libvips.name}/binary`);
  checkpoint(ctx);
  if (
    (await realpath(queried)) !== expectedLibrary ||
    !same(edgeBefore, await lstat(edge, { bigint: true })) ||
    (await realpath(edge)) !== libvipsRoot
  )
    fail("FILE_CHANGED");
  checkpoint(ctx);
  return {
    platform: platform as MediaDeploymentSharpRuntime["platform"],
    packageRoots,
  };
}
/** A finite installed runtime, independent of Argon2's build-time toolchain. */
async function argon2Mapping(
  bound: MediaDeploymentRoots,
  ctx: MediaDeploymentContext,
): Promise<MediaDeploymentArgon2Runtime | null> {
  const declaration = packageIdentity(
    (await readRegular(bound.checkoutRoot, "package.json", ctx)).bytes,
  ).dependencies.argon2;
  if (declaration === undefined) return null; // The sharp-only offline fixture has no authentication runtime.
  if (declaration !== ARGON2_PACKAGES[0].version) fail("DEPENDENCY_INVALID");
  if (
    ARGON2_SELECTION_ENV.some((name) => process.env[name] !== undefined) ||
    process.versions.electron ||
    process.versions.nw
  )
    fail("DEPENDENCY_INVALID");
  const platform = sharpPlatform();
  if (platform === "linux-x64") {
    // The loader otherwise treats this fixed host marker as musl, even when a
    // glibc-compatible Node supplies a glibc report. Never select its other ABI.
    try {
      await lstat("/etc/alpine-release", { bigint: true });
      checkpoint(ctx);
      fail("DEPENDENCY_INVALID");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      checkpoint(ctx);
    }
  }
  const packageRoots: MediaDeploymentArgon2Runtime["packageRoots"] = [];
  const checkoutRequire = createRequire(
    path.join(bound.checkoutRoot, "package.json"),
  );
  let argonRoot = "";
  for (const fixed of ARGON2_PACKAGES) {
    const root = argon2Root(fixed.name, fixed.version);
    const actual = path.join(bound.checkoutRoot, root);
    const edge =
      fixed.name === "argon2"
        ? path.join(bound.checkoutRoot, "node_modules/argon2")
        : path.join(
            /* turbopackIgnore: true */ path.dirname(argonRoot),
            fixed.name,
          );
    await ancestors(bound.checkoutRoot, edge, ctx);
    const before = await lstat(edge, { bigint: true });
    checkpoint(ctx);
    if (!before.isSymbolicLink() || before.uid !== BigInt(process.getuid!()))
      fail("DEPENDENCY_INVALID");
    const text = await readlink(edge);
    checkpoint(ctx);
    if (
      !validText(text) ||
      Buffer.byteLength(text) > 4096 ||
      path.resolve(path.dirname(edge), text) !== actual ||
      (await realpath(edge)) !== actual
    )
      fail("DEPENDENCY_INVALID");
    checkpoint(ctx);
    const metadata = await readRegular(
      bound.checkoutRoot,
      root + "/package.json",
      ctx,
      undefined,
      false,
      64 * 1024,
    );
    const identity = packageIdentity(metadata.bytes);
    const raw = object(JSON.parse(metadata.bytes.toString("utf8")));
    if (
      identity.name !== fixed.name ||
      identity.version !== fixed.version ||
      raw.main !== fixed.entry ||
      raw.exports !== undefined
    )
      fail("DEPENDENCY_INVALID");
    if (
      fixed.name === "argon2" &&
      (identity.dependencies["@phc/format"] !== "^1.0.0" ||
        identity.dependencies["node-gyp-build"] !== "^4.8.4")
    )
      fail("DEPENDENCY_INVALID");
    const entry = root + "/" + fixed.entry;
    await readRegular(bound.checkoutRoot, entry, ctx);
    const resolver =
      fixed.name === "argon2"
        ? checkoutRequire
        : createRequire(path.join(argonRoot, "package.json"));
    if (
      typeof (resolver as unknown as { addon?: unknown }).addon === "function"
    )
      fail("DEPENDENCY_INVALID");
    const resolved = resolver.resolve(fixed.name);
    checkpoint(ctx);
    if (
      resolved !== path.join(bound.checkoutRoot, entry) ||
      (await realpath(resolved)) !== resolved
    )
      fail("DEPENDENCY_INVALID");
    checkpoint(ctx);
    if (
      !same(before, await lstat(edge, { bigint: true })) ||
      (await readlink(edge)) !== text ||
      (await realpath(edge)) !== actual
    )
      fail("FILE_CHANGED");
    checkpoint(ctx);
    packageRoots.push({ name: fixed.name, root, entry });
    if (fixed.name === "argon2") argonRoot = actual;
  }
  // node-gyp-build loads this second JS file, then prefers local Release/Debug
  // builds over prebuilds. Never admit an unregistered priority directory.
  await readRegular(
    bound.checkoutRoot,
    packageRoots[2]!.root + "/node-gyp-build.js",
    ctx,
  );
  for (const leaf of ["build/Release", "build/Debug"]) {
    await ancestors(bound.checkoutRoot, path.join(argonRoot, leaf), ctx).catch(
      (error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      },
    );
    try {
      await lstat(path.join(argonRoot, leaf), { bigint: true });
      checkpoint(ctx);
      fail("DEPENDENCY_INVALID");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      checkpoint(ctx);
    }
  }
  const nativePath = packageRoots[0]!.root + "/" + argon2Native(platform);
  // Require the local platform's native before any executable-adjacent fallback
  // could be selected. No loader or native addon is executed during binding.
  let native;
  try {
    native = (await readRegular(bound.checkoutRoot, nativePath, ctx)).entry;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      fail("DEPENDENCY_INVALID");
    throw error;
  }
  if (native.bytes === 0) fail("DEPENDENCY_INVALID");
  const nativeDirectory = path.dirname(
    path.join(bound.checkoutRoot, nativePath),
  );
  const before = await directory(nativeDirectory, ctx);
  const dir = await opendir(nativeDirectory, { bufferSize: 16 });
  try {
    for (;;) {
      const entry = await dir.read();
      checkpoint(ctx);
      if (!entry) break;
      // The fixed Linux package also carries musl; it cannot win under the
      // proven glibc platform. Every other entry could alter loader selection.
      if (
        !entry.isFile() ||
        ![
          path.basename(nativePath),
          ...(platform === "linux-x64" ? ["argon2.musl.node"] : []),
        ].includes(entry.name)
      )
        fail("DEPENDENCY_INVALID");
    }
    if (!same(before, await lstat(nativeDirectory, { bigint: true })))
      fail("FILE_CHANGED");
    checkpoint(ctx);
  } finally {
    await dir.close();
  }
  checkpoint(ctx);
  // Validate and fingerprint the complete three-package closure before the
  // first artifact chmod, including otherwise unselected package files. Never
  // traverse links into build-only dependencies or another package root.
  const files: MediaDeploymentFile[] = [],
    budget = { entries: 0, files: 0, bytes: 0 };
  for (const p of packageRoots)
    await walk(bound.checkoutRoot, p.root, ctx, budget, async (file) => {
      files.push(
        (await readRegular(bound.checkoutRoot, file, ctx, budget)).entry,
      );
    });
  files.sort((a, b) => compare(a.path, b.path));
  if (
    !files.some(
      (f) =>
        f.path === native.path &&
        f.bytes === native.bytes &&
        f.sha256 === native.sha256,
    )
  )
    fail("FILE_CHANGED");
  return { platform, packageRoots, native, filesHash: argon2FilesHash(files) };
}
async function readArtifactAlias(
  bound: MediaDeploymentRoots,
  rel: string,
  accepted: AliasRoots,
  ctx: MediaDeploymentContext,
  hardening = false,
) {
  const kind = artifactAliasKind(rel, "FILE_UNSAFE"),
    targetRoot = accepted[kind];
  if (!targetRoot) fail("FILE_UNSAFE");
  const target = path.join(bound.deploymentRoot, rel);
  if (hardening) {
    for (const p of [
      bound.deploymentRoot,
      path.join(bound.deploymentRoot, "node_modules"),
    ]) {
      const s = await lstat(p, { bigint: true });
      checkpoint(ctx);
      if (
        !s.isDirectory() ||
        s.uid !== BigInt(process.getuid!()) ||
        (s.mode & BigInt(0o7000)) !== BigInt(0) ||
        (s.mode & BigInt(0o700)) !== BigInt(0o700)
      )
        fail("FILE_UNSAFE");
    }
  } else await ancestors(bound.deploymentRoot, target, ctx);
  const before = await lstat(target, { bigint: true });
  checkpoint(ctx);
  if (!before.isSymbolicLink() || before.uid !== BigInt(process.getuid!()))
    fail("FILE_UNSAFE");
  const text = await readlink(target);
  checkpoint(ctx);
  if (!validText(text) || Buffer.byteLength(text) > 4096) fail("FILE_UNSAFE");
  if (
    path.resolve(path.dirname(target), text) !==
    path.join(bound.checkoutRoot, targetRoot)
  )
    fail("FILE_UNSAFE");
  const actual = await realpath(target);
  checkpoint(ctx);
  if (actual !== path.join(bound.checkoutRoot, targetRoot)) fail("FILE_UNSAFE");
  const after = await lstat(target, { bigint: true });
  checkpoint(ctx);
  if (
    !same(before, after) ||
    (await readlink(target)) !== text ||
    (await realpath(target)) !== actual
  )
    fail("FILE_CHANGED");
  checkpoint(ctx);
  return {
    kind,
    stat: before,
    entry: { path: rel, targetRoot, readlinkSha256: digest(text) },
  };
}
async function artifactAliases(
  bound: MediaDeploymentRoots,
  accepted: AliasRoots,
  ctx: MediaDeploymentContext,
  budget: Budget,
): Promise<MediaDeploymentArtifactAlias[]> {
  const target = path.join(bound.deploymentRoot, "node_modules");
  try {
    await directory(target, ctx);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const aliases: MediaDeploymentArtifactAlias[] = [];
  const kinds = new Set<AliasKind>();
  const dir = await opendir(target, { bufferSize: 16 });
  try {
    const before = await lstat(target, { bigint: true });
    checkpoint(ctx);
    for (;;) {
      const entry = await dir.read();
      checkpoint(ctx);
      if (!entry) break;
      if (++budget.entries > MAX_ENTRIES) fail("LIMIT_EXCEEDED");
      if (!entry.isSymbolicLink()) fail("FILE_UNSAFE");
      const alias = await readArtifactAlias(
        bound,
        "node_modules/" + entry.name,
        accepted,
        ctx,
      );
      if (kinds.has(alias.kind)) fail("FILE_UNSAFE");
      kinds.add(alias.kind);
      aliases.push(alias.entry);
    }
    if (!same(before, await lstat(target, { bigint: true })))
      fail("FILE_CHANGED");
    checkpoint(ctx);
  } finally {
    await dir.close();
  }
  checkpoint(ctx);
  return aliases.sort((a, b) => compare(a.path, b.path));
}
async function snapshot(
  bound: MediaDeploymentRoots,
  ctx: MediaDeploymentContext,
): Promise<MediaDeploymentManifest> {
  const budget = { entries: 0, files: 0, bytes: 0 };
  const sourceFiles: MediaDeploymentSourceFile[] = [];
  const artifactFiles: MediaDeploymentFile[] = [];
  const sharpRuntime = await sharpMapping(bound, ctx);
  const argon2Runtime = await argon2Mapping(bound, ctx);
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
  for (const p of sharpRuntime.packageRoots) {
    await walk(bound.checkoutRoot, p.root, ctx, budget, async (file) => {
      sourceFiles.push({
        role: "sharp-runtime",
        ...(
          await readRegular(
            bound.checkoutRoot,
            file,
            ctx,
            budget,
            false,
            MAX_SHARP_FILE,
          )
        ).entry,
      });
    });
  }
  if (argon2Runtime) {
    for (const p of argon2Runtime.packageRoots)
      await walk(bound.checkoutRoot, p.root, ctx, budget, async (file) => {
        sourceFiles.push({
          role: "argon2-runtime",
          ...(await readRegular(bound.checkoutRoot, file, ctx, budget)).entry,
        });
      });
  }
  if (
    argon2Runtime &&
    argon2FilesHash(
      sourceFiles
        .filter((f) => f.role === "argon2-runtime")
        .sort((a, b) => compare(a.path, b.path)),
    ) !== argon2Runtime.filesHash
  )
    fail("FILE_CHANGED");
  if (
    JSON.stringify(await argon2Mapping(bound, ctx)) !==
    JSON.stringify(argon2Runtime)
  )
    fail("FILE_CHANGED");
  if (
    JSON.stringify(await sharpMapping(bound, ctx)) !==
    JSON.stringify(sharpRuntime)
  )
    fail("FILE_CHANGED");
  const aliases = await artifactAliases(
    bound,
    aliasRoots(sharpRuntime, argon2Runtime),
    ctx,
    budget,
  );
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
    sharpRuntime,
    argon2Runtime,
    sourceFiles,
    artifactFiles,
    artifactAliases: aliases,
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
    // This fixed private runtime manifest directory is never a build asset.
    current = path.join(/* turbopackIgnore: true */ current, part);
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
      (before.mode & BigInt(0o777)) !== BigInt(0o600) ||
      before.nlink !== BigInt(1)
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
      if (
        !owned(stat) ||
        (stat.mode & BigInt(0o777)) !== BigInt(0o600) ||
        stat.nlink !== BigInt(1)
      )
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
      // Sync the checked private manifest directory, not traced build content.
      /* turbopackIgnore: true */ leaf,
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

/** Offline build step only. Runtime verification never calls this writer.
 * The two fixed completed-Next roots are the entire permission-change scope.
 * Preflight every entry before the first chmod; reject aliases/hardlinks rather
 * than changing permissions on an inode shared with source or dependencies.
 */
export async function hardenMediaDeploymentArtifacts(
  input: MediaDeploymentRoots,
  supplied: MediaDeploymentContext,
): Promise<MediaDeploymentHardeningResult> {
  const summary: MediaDeploymentHardeningSummary = {
    checkedFiles: 0,
    checkedDirectories: 0,
    changedFiles: 0,
    changedDirectories: 0,
  };
  let ctx: MediaDeploymentContext | undefined;
  try {
    ctx = context(supplied);
    checkpoint(ctx);
    if (
      !input ||
      Object.keys(input).length !== 2 ||
      !Object.hasOwn(input, "checkoutRoot") ||
      !Object.hasOwn(input, "deploymentRoot") ||
      !absolutePath(input.checkoutRoot) ||
      !absolutePath(input.deploymentRoot)
    )
      fail("ROOTS_INVALID");
    if (
      (await realpath(input.checkoutRoot)) !== input.checkoutRoot ||
      (await realpath(input.deploymentRoot)) !== input.deploymentRoot
    )
      fail("ROOTS_INVALID");
    checkpoint(ctx);
    const selected = path
      .relative(input.checkoutRoot, input.deploymentRoot)
      .split(path.sep)
      .join("/");
    if (
      ![".next", ".cache/quizpack-media-next-fixture/.next"].includes(selected)
    )
      fail("ROOTS_INVALID");
    await ancestors(input.checkoutRoot, input.deploymentRoot, ctx);
    const entries: { rel: string; stat: BigIntStats }[] = [];
    const sharpRuntime = await sharpMapping(input, ctx);
    const argon2Runtime = await argon2Mapping(input, ctx);
    const accepted = aliasRoots(sharpRuntime, argon2Runtime);
    const kinds = new Set<AliasKind>();
    const aliases: Awaited<ReturnType<typeof readArtifactAlias>>[] = [];
    let itemCount = 0;
    let totalBytes = 0;
    const ownerOnly = (s: BigIntStats) =>
      typeof process.getuid === "function" &&
      s.uid === BigInt(process.getuid()) &&
      (s.mode & BigInt(0o7000)) === BigInt(0);
    const gather = async (rel: string): Promise<void> => {
      checkpoint(ctx!);
      const target = path.join(input.deploymentRoot, rel);
      const stat = await lstat(target, { bigint: true });
      checkpoint(ctx!);
      if (!ownerOnly(stat)) fail("FILE_UNSAFE");
      if (stat.isSymbolicLink()) {
        const alias = await readArtifactAlias(input, rel, accepted, ctx!, true);
        if (kinds.has(alias.kind)) fail("FILE_UNSAFE");
        kinds.add(alias.kind);
        aliases.push(alias);
        return;
      }
      if (rel.startsWith("node_modules/")) fail("FILE_UNSAFE");
      if (stat.isFile()) {
        if (
          stat.nlink !== BigInt(1) ||
          (stat.mode & BigInt(0o600)) !== BigInt(0o600)
        )
          fail("FILE_UNSAFE");
        if (
          ++summary.checkedFiles > MAX_FILES ||
          stat.size > BigInt(MAX_FILE) ||
          (totalBytes += Number(stat.size)) > MAX_TOTAL
        )
          fail("LIMIT_EXCEEDED");
        entries.push({ rel, stat });
      } else if (stat.isDirectory()) {
        if ((stat.mode & BigInt(0o700)) !== BigInt(0o700)) fail("FILE_UNSAFE");
        summary.checkedDirectories++;
        entries.push({ rel, stat });
        const dir = await opendir(target, { bufferSize: 16 });
        try {
          for (;;) {
            const next = await dir.read();
            checkpoint(ctx!);
            if (!next) break;
            if (++itemCount > MAX_ENTRIES) fail("LIMIT_EXCEEDED");
            const child = rel ? rel + "/" + next.name : next.name;
            if (!relativePath(child)) fail("FILE_UNSAFE");
            await gather(child);
          }
        } finally {
          await dir.close();
        }
        checkpoint(ctx!);
        if (!same(stat, await lstat(target, { bigint: true })))
          fail("FILE_CHANGED");
        checkpoint(ctx!);
      } else fail("FILE_UNSAFE");
    };
    await gather("");
    for (const file of ARTIFACT_FIXED_FILES)
      if (!entries.some((e) => e.rel === file && e.stat.isFile()))
        fail("BUILD_INCOMPLETE");
    if (
      !entries.some(
        (e) =>
          e.rel.startsWith("server/") &&
          e.rel.endsWith(".js") &&
          e.stat.isFile(),
      )
    )
      fail("BUILD_INCOMPLETE");
    // Parents precede children. Chmod through a no-follow descriptor and require
    // the exact preflight inode; no chmod(path) can follow a replacement alias.
    for (const entry of entries) {
      checkpoint(ctx);
      const target = path.join(input.deploymentRoot, entry.rel);
      if (entry.rel) await ancestors(input.deploymentRoot, target, ctx);
      const flags =
        constants.O_RDONLY |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK |
        (entry.stat.isDirectory() ? constants.O_DIRECTORY : 0);
      const descriptor = await open(target, flags);
      try {
        const before = await descriptor.stat({ bigint: true });
        checkpoint(ctx);
        if (
          !same(entry.stat, before) ||
          !ownerOnly(before) ||
          (before.isFile() && before.nlink !== BigInt(1))
        )
          fail("FILE_CHANGED");
        const mode = before.isDirectory() ? 0o700 : 0o600;
        if ((before.mode & BigInt(0o7777)) !== BigInt(mode)) {
          await descriptor.chmod(mode);
          if (before.isDirectory()) summary.changedDirectories++;
          else summary.changedFiles++;
        }
        checkpoint(ctx);
        const after = await descriptor.stat({ bigint: true });
        checkpoint(ctx);
        if (
          before.dev !== after.dev ||
          before.ino !== after.ino ||
          before.size !== after.size ||
          before.mtimeNs !== after.mtimeNs ||
          (after.mode & BigInt(0o7777)) !== BigInt(mode) ||
          !ownerOnly(after) ||
          (after.isFile() && after.nlink !== BigInt(1))
        )
          fail("FILE_CHANGED");
        if (!same(after, await lstat(target, { bigint: true })))
          fail("FILE_CHANGED");
        checkpoint(ctx);
      } finally {
        await descriptor.close();
      }
      checkpoint(ctx);
    }
    for (const alias of aliases) {
      const after = await readArtifactAlias(
        input,
        alias.entry.path,
        accepted,
        ctx,
      );
      if (
        !same(alias.stat, after.stat) ||
        JSON.stringify(alias.entry) !== JSON.stringify(after.entry)
      )
        fail("FILE_CHANGED");
    }
    if (
      JSON.stringify(await argon2Mapping(input, ctx)) !==
      JSON.stringify(argon2Runtime)
    )
      fail("FILE_CHANGED");
    if (
      JSON.stringify(await sharpMapping(input, ctx)) !==
      JSON.stringify(sharpRuntime)
    )
      fail("FILE_CHANGED");
    checkpoint(ctx);
    return { ok: true, summary };
  } catch (error) {
    return { ok: false, code: finalCode(error, ctx), summary };
  }
}
