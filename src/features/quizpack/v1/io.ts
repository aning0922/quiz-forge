import { constants } from "node:fs";
import { open, lstat, realpath, link, unlink } from "node:fs/promises";
import { dirname, resolve, relative, sep, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import {
  canonicalFoundationJson,
  parseFoundationJson,
  FoundationJsonError,
  type FoundationJson,
} from "../../../lib/foundation-json";
import {
  PackToolError,
  abortable,
  readBoundedBytes,
  throwIfAborted,
} from "./zip";

export function canonicalPackJson(input: unknown): string {
  try {
    return canonicalFoundationJson(input);
  } catch (error) {
    throw new PackToolError(
      error instanceof FoundationJsonError ? error.code : "JSON_INVALID_VALUE",
    );
  }
}
export function parsePackJson(
  bytes: Uint8Array,
  maxDepth: number,
): FoundationJson {
  let parsed: FoundationJson;
  try {
    const source = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    parsed = parseFoundationJson(source);
  } catch (error) {
    throw new PackToolError(
      error instanceof FoundationJsonError ? error.code : "JSON_ENCODING",
    );
  }
  const walk = (value: FoundationJson, depth: number) => {
    if (value === null || typeof value !== "object") return;
    if (depth >= maxDepth) throw new PackToolError("JSON_DEPTH_LIMIT");
    for (const child of Object.values(value)) walk(child, depth + 1);
  };
  walk(parsed, 0);
  return parsed;
}
async function rejectLinks(path: string): Promise<void> {
  let cursor = resolve(path);
  while (true) {
    const facts = await lstat(cursor);
    if (facts.isSymbolicLink()) throw new PackToolError("IO_SOURCE_LINK");
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}
/** No scan: callers provide exactly one local filename. Final open is O_NOFOLLOW. */
export async function readLocalFile(
  path: string,
  max: number,
  signal: AbortSignal,
): Promise<Buffer> {
  try {
    throwIfAborted(signal);
    await rejectLinks(path);
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const facts = await handle.stat();
      if (!facts.isFile()) throw new PackToolError("IO_SOURCE_NOT_FILE");
      if (facts.size > max) throw new PackToolError("INPUT_SIZE_LIMIT");
      const stream = handle.createReadStream({ autoClose: false });
      try {
        return await readBoundedBytes(stream, max, signal);
      } finally {
        stream.destroy();
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    throw error instanceof PackToolError
      ? error
      : new PackToolError("IO_INPUT_FAILED");
  }
}
/** Explicit resource source paths must remain below the build-input directory. */
export async function readResourceFile(
  base: string,
  source: string,
  max: number,
  signal: AbortSignal,
): Promise<Buffer> {
  if (
    !source ||
    isAbsolute(source) ||
    source.includes("\\") ||
    source
      .split("/")
      .some((part) => part === ".." || part === "." || part === "")
  )
    throw new PackToolError("IO_SOURCE_OUTSIDE_ROOT");
  try {
    const root = resolve(base);
    const path = resolve(root, source);
    const inside = (candidate: string) => {
      const part = relative(root, candidate);
      return (
        part !== "" &&
        part !== ".." &&
        !part.startsWith(`..${sep}`) &&
        !isAbsolute(part)
      );
    };
    if (!inside(path)) throw new PackToolError("IO_SOURCE_OUTSIDE_ROOT");
    await rejectLinks(path);
    if (!inside(await realpath(path)))
      throw new PackToolError("IO_SOURCE_OUTSIDE_ROOT");
    return await readLocalFile(path, max, signal);
  } catch (error) {
    throw error instanceof PackToolError
      ? error
      : new PackToolError("IO_INPUT_FAILED");
  }
}
/** Same-directory temporary inode + hard link commits atomically without replacement. */
export async function writeArchiveNoClobber(
  path: string,
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<void> {
  const target = resolve(path);
  const parent = dirname(target);
  const temporary = resolve(parent, `.quizpack-${randomUUID()}.tmp`);
  let created = false;
  try {
    throwIfAborted(signal);
    await rejectLinks(parent);
    const handle = await open(temporary, "wx", 0o600);
    created = true;
    try {
      await abortable(handle.writeFile(bytes), signal);
      await abortable(handle.sync(), signal);
    } finally {
      await handle.close();
    }
    throwIfAborted(signal);
    await link(temporary, target);
  } catch (error) {
    if (error instanceof PackToolError) throw error;
    throw new PackToolError(
      typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
        ? "IO_OUTPUT_EXISTS"
        : "IO_OUTPUT_FAILED",
    );
  } finally {
    if (created) await unlink(temporary).catch(() => {});
  }
}
