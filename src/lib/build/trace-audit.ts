import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

export type TraceAuditCode =
  | "BUILD_TRACE_OK"
  | "BUILD_TRACE_NOT_FOUND"
  | "BUILD_TRACE_MALFORMED"
  | "BUILD_TRACE_UNSUPPORTED_SCHEMA"
  | "BUILD_TRACE_DISCOVERY_FAILED"
  | "BUILD_TRACE_READ_FAILED"
  | "BUILD_TRACE_PATH_UNRESOLVED"
  | "BUILD_TRACE_PRIVATE_PATH";

export interface TraceAuditResult {
  code: TraceAuditCode;
  traceCount: number;
  pathCount: number;
  violationCount: number;
}

type JsonRecord = Record<string, unknown>;
interface FileList {
  files: string[];
  symlinks: [number, string, number?][];
}
interface AdditionalRoot extends FileList {
  path: string;
}
interface Trace extends FileList {
  additionalRoots: AdditionalRoot[];
}

class AuditFailure extends Error {
  constructor(readonly code: TraceAuditCode) {
    super(code);
  }
}

function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AuditFailure("BUILD_TRACE_MALFORMED");
  return value as JsonRecord;
}

function fields(input: JsonRecord, allowed: string[]): void {
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new AuditFailure("BUILD_TRACE_UNSUPPORTED_SCHEMA");
}

function relativePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("\0") &&
    !value.includes("\\") &&
    !path.isAbsolute(value) &&
    !/^[a-zA-Z]:/.test(value)
  );
}

function fileList(input: JsonRecord, rootCount: number): FileList {
  if (!Array.isArray(input.files) || !input.files.every(relativePath))
    throw new AuditFailure("BUILD_TRACE_MALFORMED");
  const files = input.files as string[];
  if (
    input.fileHashes !== undefined &&
    (!Array.isArray(input.fileHashes) ||
      input.fileHashes.length !== files.length ||
      !input.fileHashes.every((hash) => typeof hash === "string"))
  )
    throw new AuditFailure("BUILD_TRACE_MALFORMED");
  const symlinks = input.symlinks === undefined ? [] : input.symlinks;
  if (!Array.isArray(symlinks)) throw new AuditFailure("BUILD_TRACE_MALFORMED");
  let previous = -1;
  for (const link of symlinks) {
    if (
      !Array.isArray(link) ||
      (link.length !== 2 && link.length !== 3) ||
      !Number.isInteger(link[0]) ||
      link[0] <= previous ||
      link[0] >= files.length ||
      !relativePath(link[1]) ||
      (link.length === 3 &&
        (!Number.isInteger(link[2]) || link[2] < -1 || link[2] >= rootCount))
    )
      throw new AuditFailure("BUILD_TRACE_MALFORMED");
    previous = link[0] as number;
  }
  return { files, symlinks: symlinks as FileList["symlinks"] };
}

function parseTrace(value: unknown): Trace {
  const input = record(value);
  fields(input, [
    "version",
    "files",
    "fileHashes",
    "symlinks",
    "entryHash",
    "additionalRoots",
  ]);
  if (
    input.version !== 1 ||
    (input.entryHash !== undefined && typeof input.entryHash !== "string")
  )
    throw new AuditFailure("BUILD_TRACE_MALFORMED");
  const roots =
    input.additionalRoots === undefined ? [] : input.additionalRoots;
  if (!Array.isArray(roots)) throw new AuditFailure("BUILD_TRACE_MALFORMED");
  if (input.additionalRoots !== undefined && input.symlinks === undefined)
    throw new AuditFailure("BUILD_TRACE_MALFORMED");
  const names = new Set<string>();
  const additionalRoots = roots.map((value) => {
    const root = record(value);
    fields(root, ["name", "path", "files", "fileHashes", "symlinks"]);
    if (
      typeof root.name !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(root.name) ||
      names.has(root.name.toLowerCase()) ||
      !relativePath(root.path) ||
      root.symlinks === undefined
    )
      throw new AuditFailure("BUILD_TRACE_MALFORMED");
    names.add(root.name.toLowerCase());
    return { ...fileList(root, roots.length), path: root.path };
  });
  return { ...fileList(input, roots.length), additionalRoots };
}

function privatePath(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) return false;
  if (path.isAbsolute(relative)) return false;
  const first = (relative.split(path.sep)[0] ?? "").toLowerCase();
  return (
    [".cache", ".git", "test-results", "playwright-report"].includes(first) ||
    first.startsWith(".env")
  );
}

function missing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

// A missing leaf still needs its existing ancestors resolved: an alias to a
// private directory must not escape the guard merely because its leaf vanished.
async function resolveExisting(candidate: string): Promise<string> {
  let ancestor = candidate;
  const suffix: string[] = [];
  for (;;) {
    try {
      return path.resolve(await realpath(ancestor), ...suffix);
    } catch (error) {
      if (!missing(error))
        throw new AuditFailure("BUILD_TRACE_PATH_UNRESOLVED");
      const parent = path.dirname(ancestor);
      if (parent === ancestor)
        throw new AuditFailure("BUILD_TRACE_PATH_UNRESOLVED");
      suffix.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
}

async function discover(
  directory: string,
  ensurePublic: (candidate: string) => Promise<void>,
  visited = new Set<string>(),
): Promise<string[]> {
  const found: string[] = [];
  try {
    // Resolve directory aliases before listing them, so discovery never enters
    // private storage. Dependency aliases are permitted and cycles are bounded.
    await ensurePublic(directory);
    const canonical = await realpath(directory);
    if (visited.has(canonical)) return found;
    visited.add(canonical);
    if (!(await stat(directory)).isDirectory())
      throw new AuditFailure("BUILD_TRACE_DISCOVERY_FAILED");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        await ensurePublic(file);
        const info = await stat(file);
        if (info.isDirectory())
          found.push(...(await discover(file, ensurePublic, visited)));
        else if (entry.name.endsWith(".nft.json")) {
          if (!info.isFile())
            throw new AuditFailure("BUILD_TRACE_DISCOVERY_FAILED");
          found.push(await realpath(file));
        }
      } else if (entry.isDirectory())
        found.push(...(await discover(file, ensurePublic, visited)));
      else if (entry.name.endsWith(".nft.json")) {
        if (!entry.isFile())
          throw new AuditFailure("BUILD_TRACE_DISCOVERY_FAILED");
        found.push(file);
      }
    }
  } catch (error) {
    if (error instanceof AuditFailure) throw error;
    if (missing(error)) throw new AuditFailure("BUILD_TRACE_NOT_FOUND");
    throw new AuditFailure("BUILD_TRACE_DISCOVERY_FAILED");
  }
  return found.sort();
}

/** Audit trace metadata and paths only; never read a traced dependency's contents. */
export async function auditBuildTraces(
  root: string,
): Promise<TraceAuditResult> {
  const result: TraceAuditResult = {
    code: "BUILD_TRACE_OK",
    traceCount: 0,
    pathCount: 0,
    violationCount: 0,
  };
  const violations = new Set<string>();
  try {
    const absoluteRoot = path.resolve(root);
    const canonicalRoot = await realpath(absoluteRoot);
    const resolutionCache = new Map<string, Promise<string>>();
    async function check(candidate: string): Promise<void> {
      result.pathCount++;
      const normalized = path.resolve(candidate);
      if (
        privatePath(normalized, absoluteRoot) ||
        privatePath(normalized, canonicalRoot)
      ) {
        violations.add(normalized);
        return;
      }
      let resolved = resolutionCache.get(candidate);
      if (!resolved) {
        resolved = resolveExisting(candidate);
        resolutionCache.set(candidate, resolved);
      }
      const canonical = await resolved;
      if (
        privatePath(canonical, absoluteRoot) ||
        privatePath(canonical, canonicalRoot)
      )
        violations.add(normalized);
    }
    const traces = await discover(
      path.join(absoluteRoot, ".next"),
      async (candidate) => {
        await check(candidate);
        if (violations.size) throw new AuditFailure("BUILD_TRACE_PRIVATE_PATH");
      },
    );
    if (!traces.length) throw new AuditFailure("BUILD_TRACE_NOT_FOUND");
    result.traceCount = traces.length;
    for (const traceFile of traces) {
      let json: unknown;
      try {
        json = JSON.parse(await readFile(traceFile, "utf8"));
      } catch (error) {
        throw new AuditFailure(
          error instanceof SyntaxError
            ? "BUILD_TRACE_MALFORMED"
            : "BUILD_TRACE_READ_FAILED",
        );
      }
      const trace = parseTrace(json);
      const base = path.dirname(traceFile);
      const bases = trace.additionalRoots.map((root) => `${base}/${root.path}`);
      for (const rootBase of bases) await check(rootBase);
      const lists = [trace, ...trace.additionalRoots];
      for (const [index, list] of lists.entries()) {
        const listBase = index === 0 ? base : bases[index - 1]!;
        for (const file of list.files) await check(`${listBase}/${file}`);
        for (const [, target, rootIndex] of list.symlinks) {
          const targetBase =
            rootIndex === undefined
              ? listBase
              : rootIndex === -1
                ? base
                : bases[rootIndex]!;
          await check(`${targetBase}/${target}`);
        }
      }
    }
    if (violations.size) result.code = "BUILD_TRACE_PRIVATE_PATH";
  } catch (error) {
    result.code =
      error instanceof AuditFailure ? error.code : "BUILD_TRACE_READ_FAILED";
  }
  result.violationCount = violations.size;
  return result;
}
