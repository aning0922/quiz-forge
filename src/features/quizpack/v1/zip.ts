import { createHash } from "node:crypto";
import { createInflateRaw } from "node:zlib";
import { createRequire } from "node:module";
const crc32 = createRequire(import.meta.url)("buffer-crc32") as {
  unsigned(bytes: Buffer): number;
};
import type { PackIssue, Result, ValidationContext } from "./api";
import { resolvePackLimits, type PackLimits } from "./limits";

export class PackToolError extends Error {
  constructor(public readonly code: string) {
    super("QuizPack operation rejected.");
  }
}
export const packIssue = (code: string): PackIssue => ({
  code,
  path: [],
  message: "QuizPack operation rejected.",
});
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw new PackToolError(
      signal.reason instanceof PackToolError
        ? signal.reason.code
        : "OPERATION_CANCELLED",
    );
}
export async function withPackDeadline<T>(
  context: ValidationContext,
  work: (signal: AbortSignal, limits: Readonly<PackLimits>) => Promise<T>,
): Promise<T> {
  const resolved = resolvePackLimits(context.limits);
  if (!resolved.ok) throw new PackToolError("INVALID_LIMITS");
  const limits = resolved.value;
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(new PackToolError("OPERATION_CANCELLED"));
  context.signal?.addEventListener("abort", cancel, { once: true });
  if (context.signal?.aborted) cancel();
  const timer = setTimeout(
    () => controller.abort(new PackToolError("OPERATION_TIMEOUT")),
    limits.operationMs,
  );
  try {
    throwIfAborted(controller.signal);
    return await work(controller.signal, limits);
  } finally {
    clearTimeout(timer);
    context.signal?.removeEventListener("abort", cancel);
  }
}
/** Races a pending read and removes its listener even when the source rejects. */
export async function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  let onAbort: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => {
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, interrupted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
export async function readBoundedBytes(
  source: AsyncIterable<Uint8Array>,
  max: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const iterator = source[Symbol.asyncIterator]();
  const chunks: Buffer[] = [];
  let size = 0;
  let finished = false;
  try {
    while (true) {
      throwIfAborted(signal);
      const item = await abortable(Promise.resolve(iterator.next()), signal);
      if (item.done) {
        finished = true;
        break;
      }
      if (!(item.value instanceof Uint8Array))
        throw new PackToolError("INPUT_INVALID_BYTES");
      size += item.value.byteLength;
      if (size > max) throw new PackToolError("INPUT_SIZE_LIMIT");
      chunks.push(Buffer.from(item.value));
    }
    return Buffer.concat(chunks, size);
  } finally {
    if (!finished) {
      // Node streams are actively closed. An arbitrary iterator may have a pending
      // next() forever, so invoke return without letting it hold cancellation open.
      if ("destroy" in source && typeof source.destroy === "function")
        source.destroy();
      void Promise.resolve(iterator.return?.()).catch(() => {});
    }
  }
}
export interface RestrictedZip {
  archiveSha256: string;
  files: ReadonlyMap<string, Buffer>;
}
interface Entry {
  name: string;
  offset: number;
  start: number;
  compressed: number;
  size: number;
  crc: number;
  method: number;
  flags: number;
  time: number;
  date: number;
}
export function isPackPath(path: string): boolean {
  return (
    path === "manifest.json" ||
    path === "content.json" ||
    /^assets\/[a-z0-9][a-z0-9_-]*\.(png|jpg|webp)$/.test(path)
  );
}
function maximum(name: string, limits: PackLimits): number {
  return name === "manifest.json"
    ? limits.manifestBytes
    : name === "content.json"
      ? limits.contentBytes
      : limits.resourceBytes;
}
function scan(bytes: Buffer, limits: PackLimits): Entry[] {
  const fail = (code = "ZIP_INVALID_STRUCTURE"): never => {
    throw new PackToolError(code);
  };
  const end = bytes.length - 22;
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) {
    const found = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (
      found >= 0 &&
      found + 22 <= bytes.length &&
      bytes.readUInt16LE(found + 20)
    )
      fail("ZIP_UNSUPPORTED_PROFILE");
    return fail();
  }
  if (
    bytes.readUInt16LE(end + 4) ||
    bytes.readUInt16LE(end + 6) ||
    bytes.readUInt16LE(end + 20)
  )
    fail("ZIP_UNSUPPORTED_PROFILE");
  const count = bytes.readUInt16LE(end + 10);
  const centralSize = bytes.readUInt32LE(end + 12);
  const central = bytes.readUInt32LE(end + 16);
  if (count === 0xffff || central === 0xffffffff || centralSize === 0xffffffff)
    fail("ZIP_UNSUPPORTED_PROFILE");
  if (bytes.readUInt16LE(end + 8) !== count || central + centralSize !== end)
    fail();
  if (count > limits.entries) fail("ZIP_ENTRY_LIMIT");
  let cursor = central;
  let total = 0;
  let compressedTotal = 0;
  let resources = 0;
  const names = new Set<string>();
  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) fail();
    const version = bytes.readUInt16LE(cursor + 6);
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extra = bytes.readUInt16LE(cursor + 30);
    const comment = bytes.readUInt16LE(cursor + 32);
    const attributes = bytes.readUInt32LE(cursor + 38);
    const mode = attributes >>> 16;
    const host = bytes[cursor + 5];
    if (
      version > 20 ||
      flags & ~0x800 ||
      (method !== 0 && method !== 8) ||
      extra ||
      comment ||
      bytes.readUInt16LE(cursor + 34) ||
      compressed === 0xffffffff ||
      size === 0xffffffff ||
      bytes.readUInt32LE(cursor + 42) === 0xffffffff
    )
      fail("ZIP_UNSUPPORTED_PROFILE");
    if (
      (host !== 0 && host !== 3) ||
      attributes & 0x18 ||
      (mode && ((mode & 0xf000) !== 0x8000 || mode & 0o111))
    )
      fail("ZIP_UNSUPPORTED_PROFILE");
    if (!nameLength || cursor + 46 + nameLength > end) fail();
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    if (rawName.some((byte) => byte > 0x7f)) fail("ZIP_INVALID_PATH");
    const name = rawName.toString("ascii");
    if (!isPackPath(name)) fail("ZIP_INVALID_PATH");
    if (names.has(name)) fail("ZIP_DUPLICATE_PATH");
    names.add(name);
    if (name.startsWith("assets/") && ++resources > limits.resources)
      fail("ZIP_RESOURCE_LIMIT");
    if (size > maximum(name, limits)) fail("ZIP_FILE_SIZE_LIMIT");
    if (size > compressed * limits.compressionRatio)
      fail("ZIP_COMPRESSION_RATIO_LIMIT");
    total += size;
    compressedTotal += compressed;
    if (total > limits.totalUncompressedBytes) fail("ZIP_TOTAL_SIZE_LIMIT");
    entries.push({
      name,
      offset: bytes.readUInt32LE(cursor + 42),
      start: 0,
      compressed,
      size,
      crc: bytes.readUInt32LE(cursor + 16),
      method,
      flags,
      time: bytes.readUInt16LE(cursor + 12),
      date: bytes.readUInt16LE(cursor + 14),
    });
    cursor += 46 + nameLength;
  }
  if (cursor !== end || total > compressedTotal * limits.compressionRatio)
    fail();
  cursor = 0;
  for (const entry of entries.sort((a, b) => a.offset - b.offset)) {
    const offset = entry.offset;
    if (
      offset !== cursor ||
      offset + 30 > central ||
      bytes.readUInt32LE(offset) !== 0x04034b50
    )
      fail();
    const nameLength = bytes.readUInt16LE(offset + 26);
    if (bytes.readUInt16LE(offset + 28) || bytes.readUInt16LE(offset + 4) > 20)
      fail("ZIP_UNSUPPORTED_PROFILE");
    const start = offset + 30 + nameLength;
    if (
      start + entry.compressed > central ||
      bytes.subarray(offset + 30, start).toString("ascii") !== entry.name ||
      nameLength !== Buffer.byteLength(entry.name)
    )
      fail();
    // Compare bytes, not lossy ASCII decoding (high bits must not alias a name).
    if (!bytes.subarray(offset + 30, start).equals(Buffer.from(entry.name)))
      fail();
    if (
      bytes.readUInt16LE(offset + 6) !== entry.flags ||
      bytes.readUInt16LE(offset + 8) !== entry.method ||
      bytes.readUInt16LE(offset + 10) !== entry.time ||
      bytes.readUInt16LE(offset + 12) !== entry.date ||
      bytes.readUInt32LE(offset + 14) !== entry.crc ||
      bytes.readUInt32LE(offset + 18) !== entry.compressed ||
      bytes.readUInt32LE(offset + 22) !== entry.size
    )
      fail();
    if (entry.method === 0 && entry.compressed !== entry.size) fail();
    entry.start = start;
    cursor = start + entry.compressed;
  }
  if (cursor !== central) fail();
  return entries;
}
/** Entire archive layout is verified before any decompression. No disk extraction. */
export async function readRestrictedZip(
  source: AsyncIterable<Uint8Array>,
  context: ValidationContext,
): Promise<Result<RestrictedZip>> {
  try {
    return await withPackDeadline(context, async (signal, limits) => {
      const bytes = await readBoundedBytes(source, limits.archiveBytes, signal);
      const entries = scan(bytes, limits);
      const files = new Map<string, Buffer>();
      let total = 0;
      for (const entry of entries) {
        throwIfAborted(signal);
        const compressed = bytes.subarray(
          entry.start,
          entry.start + entry.compressed,
        );
        let data: Buffer;
        if (entry.method === 0) data = Buffer.from(compressed);
        else {
          const inflater = createInflateRaw({ chunkSize: 16384 });
          const stop = () =>
            inflater.destroy(new PackToolError("OPERATION_CANCELLED"));
          signal.addEventListener("abort", stop, { once: true });
          const chunks: Buffer[] = [];
          let actual = 0;
          try {
            inflater.end(compressed);
            for await (const chunk of inflater) {
              throwIfAborted(signal);
              actual += chunk.length;
              if (
                actual > entry.size ||
                actual > maximum(entry.name, limits) ||
                total + actual > limits.totalUncompressedBytes
              )
                throw new PackToolError("ZIP_ACTUAL_SIZE_LIMIT");
              if (actual > entry.compressed * limits.compressionRatio)
                throw new PackToolError("ZIP_COMPRESSION_RATIO_LIMIT");
              chunks.push(Buffer.from(chunk));
            }
            throwIfAborted(signal);
            if (inflater.bytesWritten !== compressed.length)
              throw new PackToolError("ZIP_DEFLATE_TRAILING_BYTES");
            data = Buffer.concat(chunks, actual);
          } finally {
            signal.removeEventListener("abort", stop);
            inflater.destroy();
          }
        }
        total += data.length;
        if (data.length !== entry.size)
          throw new PackToolError("ZIP_SIZE_MISMATCH");
        if (crc32.unsigned(data) !== entry.crc)
          throw new PackToolError("ZIP_CRC_MISMATCH");
        files.set(entry.name, data);
      }
      throwIfAborted(signal);
      return {
        ok: true,
        value: {
          archiveSha256: createHash("sha256").update(bytes).digest("hex"),
          files,
        },
      };
    });
  } catch (error) {
    return {
      ok: false,
      issues: [
        packIssue(
          error instanceof PackToolError ? error.code : "ZIP_READ_FAILED",
        ),
      ],
    };
  }
}
