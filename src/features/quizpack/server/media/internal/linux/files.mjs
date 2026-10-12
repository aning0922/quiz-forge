import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, mkdir, lstat } from "node:fs/promises";
import { resolve, sep, dirname } from "node:path";
export function createLinuxFiles(location) {
  const ROOT = resolve(location.checkoutRoot);
  const CACHE = resolve(location.stateRoot);
  if (!CACHE.startsWith(resolve(ROOT, ".cache") + sep))
    throw new Error("PRIVATE_PATH");
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  async function privateDir(path) {
    if (!path.startsWith(ROOT + sep)) throw new Error("PRIVATE_PATH");
    const parts = path.slice(ROOT.length + 1).split(sep);
    let next = ROOT;
    for (const part of parts) {
      next = resolve(next, part);
      try {
        await mkdir(next, { mode: 0o700 });
      } catch (e) {
        if (e.code !== "EEXIST") throw new Error("PRIVATE_DIRECTORY");
      }
      const s = await lstat(next);
      if (
        !s.isDirectory() ||
        s.isSymbolicLink() ||
        s.uid !== process.getuid() ||
        (next.startsWith(CACHE)
          ? (s.mode & 0o077) !== 0
          : (s.mode & 0o022) !== 0)
      )
        throw new Error("PRIVATE_DIRECTORY");
    }
  }
  async function writePrivate(path, bytes) {
    const f = await open(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await f.writeFile(bytes);
      await f.sync();
    } finally {
      await f.close();
    }
    const parent = await open(
      dirname(path),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  }
  async function readPrivate(path, limit = 16384) {
    const f = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const s = await f.stat();
      if (
        !s.isFile() ||
        s.uid !== process.getuid() ||
        (s.mode & 0o077) !== 0 ||
        s.size > limit
      )
        throw new Error("PRIVATE_FILE");
      const buf = Buffer.alloc(limit + 1);
      const { bytesRead } = await f.read(buf, 0, buf.length, 0);
      if (bytesRead > limit) throw new Error("PRIVATE_FILE");
      return buf.subarray(0, bytesRead);
    } finally {
      await f.close();
    }
  }
  return { hash, privateDir, writePrivate, readPrivate };
}
