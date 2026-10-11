import { constants } from "node:fs";
import { open, lstat, realpath, link, unlink } from "node:fs/promises";
import { dirname, resolve, relative, sep, isAbsolute } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  parseFoundationJson,
  FoundationJsonError,
  type FoundationJson,
} from "../../../lib/foundation-json";
import { canonicalP1Json, P1CanonicalError } from "./canonical";
import {
  PackToolError,
  abortable,
  readBoundedBytes,
  throwIfAborted,
} from "./zip";
import type { PackIssue } from "./api";

export function canonicalPackJson(input: unknown): string {
  try {
    return canonicalP1Json(input);
  } catch (error) {
    throw new PackToolError(
      error instanceof P1CanonicalError ? error.code : "JSON_INVALID_VALUE",
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
export interface ArchiveCommitReceipt {
  schemaVersion: "quizpack-output-commit.v1";
  committed: true;
  archiveSha256: string;
  bytes: number;
  postCommit: { status: "complete" | "warning"; warnings: PackIssue[] };
}
export class ArchiveOutputError extends PackToolError {
  constructor(
    code: string,
    public readonly warnings: PackIssue[] = [],
  ) {
    super(code);
  }
}
function outputWarning(code: string): PackIssue {
  return {
    code,
    path: [],
    message:
      "Output commit or temporary cleanup requires attention; do not blindly retry.",
  };
}
export function recordPostCommitInterruption(
  receipt: ArchiveCommitReceipt,
  error: unknown,
): void {
  const code =
    error instanceof PackToolError && error.code === "OPERATION_CANCELLED"
      ? "OUTPUT_COMMITTED_CANCELLED"
      : error instanceof PackToolError && error.code === "OPERATION_TIMEOUT"
        ? "OUTPUT_COMMITTED_TIMEOUT"
        : "OUTPUT_COMMITTED_INTERRUPTED";
  if (!receipt.postCommit.warnings.some((issue) => issue.code === code))
    receipt.postCommit.warnings.push(outputWarning(code));
  receipt.postCommit.status = "warning";
}
/** Link success is the commit point. A receipt records that event, not ongoing path ownership. */
export async function writeArchiveNoClobber(
  path: string,
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<ArchiveCommitReceipt> {
  const target = resolve(path);
  const parent = dirname(target);
  const temporary = resolve(parent, `.quizpack-${randomUUID()}.tmp`);
  let created = false;
  let receipt: ArchiveCommitReceipt | undefined;
  let failure = "IO_OUTPUT_FAILED";
  const warnings: PackIssue[] = [];
  try {
    throwIfAborted(signal);
    const snapshot = Buffer.from(bytes);
    const archiveSha256 = createHash("sha256").update(snapshot).digest("hex");
    throwIfAborted(signal);
    await rejectLinks(parent);
    throwIfAborted(signal);
    const handle = await open(temporary, "wx", 0o600);
    created = true;
    try {
      throwIfAborted(signal);
      await abortable(handle.writeFile(snapshot), signal);
      await abortable(handle.sync(), signal);
    } finally {
      await handle.close();
    }
    throwIfAborted(signal);
    // Do not race this side effect against cancellation: await the local result
    // so a successful link can always be represented as a committed receipt.
    await link(temporary, target);
    receipt = {
      schemaVersion: "quizpack-output-commit.v1",
      committed: true,
      archiveSha256,
      bytes: snapshot.length,
      postCommit: { status: "complete", warnings },
    };
  } catch (error) {
    failure =
      error instanceof PackToolError
        ? error.code
        : typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "EEXIST"
          ? "IO_OUTPUT_EXISTS"
          : "IO_OUTPUT_FAILED";
  } finally {
    if (created) {
      try {
        await unlink(temporary);
      } catch {
        warnings.push(outputWarning("OUTPUT_TEMP_CLEANUP_FAILED"));
      }
    }
  }
  if (receipt) {
    // Post-commit events cannot revoke the commit or authorize target deletion.
    // In particular, never unlink target: another process may already replace it.
    try {
      throwIfAborted(signal);
    } catch (error) {
      recordPostCommitInterruption(receipt, error);
    }
    if (warnings.length) receipt.postCommit.status = "warning";
    return receipt;
  }
  throw new ArchiveOutputError(failure, warnings);
}
