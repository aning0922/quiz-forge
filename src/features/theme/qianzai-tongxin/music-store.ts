import "server-only";
import { constants } from "node:fs";
import { open, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { QIANZAI_MUSIC } from "./music-manifest";

type Pin = Readonly<{ file: string; bytes: number; sha256: string }>;
const scope = Object.freeze({
  instanceId: "00486f17f741bd6d6535429e6552d161",
  origin: "http://127.0.0.1:63238",
});
const headers = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};
const missing = () => new Response(null, { status: 404, headers });
export function isQianzaiMusicTestRequest(
  request: Request,
  config: { purpose: string; instanceId: string; origin: string },
  ids: { trackId: string; version: string },
) {
  const url = new URL(request.url),
    canonical = new URL(scope.origin),
    origin = request.headers.get("origin"),
    referer = request.headers.get("referer"),
    host = request.headers.get("host");
  if (origin !== null && origin !== scope.origin) return false;
  // NextRequest normalizes loopback URL hostnames to localhost. The incoming
  // Host remains authoritative, as in the managed studio source guard.
  if (host !== canonical.host) return false;
  if (referer !== null) {
    try {
      if (new URL(referer).origin !== scope.origin) return false;
    } catch {
      return false;
    }
  }
  return (
    (request.method === "GET" || request.method === "HEAD") &&
    !request.signal.aborted &&
    config.purpose === "test" &&
    config.instanceId === scope.instanceId &&
    config.origin === scope.origin &&
    url.protocol === canonical.protocol &&
    url.port === canonical.port &&
    (url.hostname === canonical.hostname || url.hostname === "localhost") &&
    !url.username &&
    !url.password &&
    url.pathname === QIANZAI_MUSIC.url &&
    url.search === "" &&
    request.headers.get("sec-fetch-site") === "same-origin" &&
    ids.trackId === QIANZAI_MUSIC.id &&
    ids.version === QIANZAI_MUSIC.version
  );
}
/** Fixed trusted descriptor, not a directory/URL supplied by a request. Full bytes
 * are checked before serving even a range; the handle always closes. */
export async function readPinnedQianzaiMusicFile(
  directory: string,
  signal: AbortSignal,
  pin: Pin = QIANZAI_MUSIC,
): Promise<Uint8Array | null> {
  if (
    !path.isAbsolute(directory) ||
    !/^[a-z0-9-]+\.m4a$/.test(pin.file) ||
    !Number.isSafeInteger(pin.bytes) ||
    pin.bytes < 12 ||
    pin.bytes > 4_194_304 ||
    !/^[a-f0-9]{64}$/.test(pin.sha256) ||
    signal.aborted
  )
    return null;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const root = path.resolve(directory),
      stat = await lstat(root);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 ||
      (await realpath(root)) !== root
    )
      return null;
    handle = await open(
      /* turbopackIgnore: true */ path.join(root, pin.file),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.size !== pin.bytes ||
      (before.mode & 0o077) !== 0 ||
      before.uid !== process.getuid?.()
    )
      return null;
    const buffer = new Uint8Array(pin.bytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      if (signal.aborted) return null;
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat(),
      bytes = buffer.subarray(0, offset);
    if (
      signal.aborted ||
      offset !== pin.bytes ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.nlink !== 1 ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      Buffer.from(bytes.subarray(4, 8)).toString() !== "ftyp" ||
      createHash("sha256").update(bytes).digest("hex") !== pin.sha256
    )
      return null;
    return bytes;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}
export function qianzaiMusicRangeResponse(
  request: Request,
  bytes: Uint8Array,
): Response {
  const base = {
      ...headers,
      "content-type": QIANZAI_MUSIC.mediaType,
      "accept-ranges": "bytes",
    },
    range = request.headers.get("range");
  let start = 0,
    end = bytes.length - 1;
  if (range !== null) {
    const match = /^bytes=(\d{1,10})?-(\d{1,10})?$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, {
        status: 416,
        headers: { ...base, "content-range": `bytes */${bytes.length}` },
      });
    if (!match[1]) {
      const count = Number(match[2]);
      if (count === 0)
        return new Response(null, {
          status: 416,
          headers: { ...base, "content-range": `bytes */${bytes.length}` },
        });
      start = Math.max(0, bytes.length - count);
    } else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(Number(match[2]), end);
    }
    if (start > end || start >= bytes.length)
      return new Response(null, {
        status: 416,
        headers: { ...base, "content-range": `bytes */${bytes.length}` },
      });
  }
  const body = bytes.slice(start, end + 1);
  return new Response(
    request.method === "HEAD"
      ? null
      : new Blob([body as Uint8Array<ArrayBuffer>], {
          type: QIANZAI_MUSIC.mediaType,
        }),
    {
      status: range === null ? 200 : 206,
      headers: {
        ...base,
        "content-length": String(body.length),
        ...(range === null
          ? {}
          : { "content-range": `bytes ${start}-${end}/${bytes.length}` }),
      },
    },
  );
}
/** No business table, image endpoint, media capability or arbitrary path is exposed. */
export async function readQianzaiTestAudio(
  request: Request,
  ids: { trackId: string; version: string },
) {
  try {
    const config = await loadRuntimeConfig();
    if (!isQianzaiMusicTestRequest(request, config, ids)) return missing();
    const directory = path.join(
        process.cwd(),
        ".cache",
        "known-ten",
        "audio-candidate-v1",
      ),
      bytes = await readPinnedQianzaiMusicFile(directory, request.signal);
    if (!bytes || request.signal.aborted) return missing();
    return qianzaiMusicRangeResponse(request, bytes);
  } catch {
    return missing();
  }
}
