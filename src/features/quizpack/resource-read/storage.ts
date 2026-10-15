import "server-only";
import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { P2aRuntimeConfig } from "@/lib/db/runtime";
import { StudioError } from "@/lib/http-security/errors";
import { PREVIEW_LIMITS } from "@/features/product/preview/limits";
import type { ResolvedPreviewResource } from "@/features/product/preview/repository";
import {
  blobPath,
  blobsDirectory,
  instanceDirectory,
  uploadsDirectory,
  privateDirectory,
  privateFile,
} from "../import/storage";
const same = (a: Stats, b: Stats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs;
const invalid = () => new StudioError("PREVIEW_RESOURCE_UNAVAILABLE");
function mime(bytes: Buffer): string | undefined {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
}
/** Exposed IO seam only for deterministic failure tests; the actual API uses native defaults. */
export function createPrivateResourceReader(
  io = { lstat, open, privateDirectory },
) {
  return async function readPrivateResource(
    config: P2aRuntimeConfig,
    resource: ResolvedPreviewResource,
    checkpoint: () => void,
    onTimeout: () => void = () => {},
    onUnconfirmedClose: (handle: FileHandle) => void = () => {},
  ): Promise<Buffer> {
    const expires = performance.now() + PREVIEW_LIMITS.fileDeadlineMs;
    const check = () => {
      checkpoint();
      if (performance.now() >= expires)
        throw new StudioError("PREVIEW_TIMEOUT");
    };
    if (
      !Number.isSafeInteger(resource.bytes) ||
      resource.bytes < 1 ||
      resource.bytes > PREVIEW_LIMITS.imageBytes
    )
      throw invalid();
    const timer = setTimeout(onTimeout, PREVIEW_LIMITS.fileDeadlineMs);
    timer.unref?.();
    let handle: FileHandle | undefined;
    try {
      for (const dir of [
        path.dirname(instanceDirectory(config)),
        instanceDirectory(config),
        uploadsDirectory(config),
        blobsDirectory(config),
      ]) {
        check();
        await io.privateDirectory(dir, check);
        check();
      }
      const file = blobPath(config, resource.sha256);
      check();
      const before = await io.lstat(file);
      check();
      privateFile(before);
      if (before.nlink !== 1 || before.size !== resource.bytes) throw invalid();
      // Await the real open: cancellation never drops a late-arriving descriptor.
      handle = await io.open(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      check();
      const opened = await handle.stat();
      check();
      privateFile(opened);
      if (opened.nlink !== 1 || !same(before, opened)) throw invalid();
      const bytes = Buffer.alloc(resource.bytes + 1),
        hash = createHash("sha256");
      let count = 0;
      while (count < bytes.length) {
        check();
        const part = await handle.read(
          bytes,
          count,
          Math.min(PREVIEW_LIMITS.imageChunkBytes, bytes.length - count),
          count,
        );
        check();
        if (!part.bytesRead) break;
        hash.update(bytes.subarray(count, count + part.bytesRead));
        count += part.bytesRead;
      }
      const after = await handle.stat();
      check();
      privateFile(after);
      const current = await io.lstat(file);
      check();
      privateFile(current);
      if (
        count !== resource.bytes ||
        after.nlink !== 1 ||
        current.nlink !== 1 ||
        !same(opened, after) ||
        !same(after, current) ||
        hash.digest("hex") !== resource.sha256 ||
        mime(bytes.subarray(0, count)) !== resource.mediaType
      )
        throw invalid();
      return bytes.subarray(0, count);
    } catch (error) {
      if (error instanceof StudioError && /^PREVIEW_/.test(error.code))
        throw error;
      throw invalid();
    } finally {
      try {
        if (handle) {
          try {
            await handle.close();
          } catch {
            onUnconfirmedClose(handle);
            throw invalid();
          }
        }
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
export const readPrivateResource = createPrivateResourceReader();
