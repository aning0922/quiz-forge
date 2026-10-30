import "server-only";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { PlatformArt } from "./art-manifest";

/** Fixed marketing facts, not a resource-directory browser or a QuizPack permission. */
export async function readPlatformArt(
  art: PlatformArt,
  directory: string | undefined,
): Promise<Uint8Array | null> {
  if (
    !directory ||
    !path.isAbsolute(directory) ||
    !/^[a-z0-9][a-z0-9-]*\.(png|webp)$/.test(art.file) ||
    !Number.isSafeInteger(art.bytes) ||
    art.bytes < 1 ||
    art.bytes > 4_194_304 ||
    !Number.isSafeInteger(art.width) ||
    !Number.isSafeInteger(art.height) ||
    art.width < 1 ||
    art.height < 1 ||
    art.width * art.height > 16_000_000 ||
    !/^[a-f0-9]{64}$/.test(art.sha256)
  )
    return null;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const root = path.resolve(directory);
    const stat = await lstat(root);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (await realpath(root)) !== root
    )
      return null;
    const file = path.join(/* turbopackIgnore: true */ root, art.file);
    handle = await open(
      /* turbopackIgnore: true */ file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size !== art.bytes)
      return null;
    const buffer = new Uint8Array(art.bytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (
      offset !== art.bytes ||
      after.size !== art.bytes ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      return null;
    const bytes = buffer.subarray(0, offset);
    if (createHash("sha256").update(bytes).digest("hex") !== art.sha256)
      return null;
    const png =
      art.mediaType === "image/png" &&
      Buffer.from(bytes.subarray(0, 8)).equals(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
    const webp =
      art.mediaType === "image/webp" &&
      Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" &&
      Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP";
    if (!png && !webp) return null;
    if (png) {
      if (bytes.byteLength < 24) return null;
      const header = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      if (
        header.getUint32(16) !== art.width ||
        header.getUint32(20) !== art.height
      )
        return null;
    }
    return bytes;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
