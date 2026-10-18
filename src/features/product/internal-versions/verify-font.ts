import "server-only";
import { constants, type Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { StudioError } from "@/lib/http-security/errors";
import type { InternalVersionWork } from "./lifecycle";

type FileFact = Readonly<{ path: string; bytes: number; sha256: string }>;
type Font = Readonly<{
  file: string;
  fileSha256: string;
  bytes: number;
  coverage: string;
  coverageSha256: string;
  licenseFile: string;
  licenseSha256: string;
}>;
const unavailable = () => new StudioError("VERSION_DEPENDENCY_UNAVAILABLE");
const same = (a: Stats, b: Stats) =>
  a.dev === b.dev &&
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.nlink === 1 &&
  b.nlink === 1;
/** Actual static asset bytes only. Never reads source code or reconstructs implementation identity at runtime. */
export async function verifyFixedFontFiles(
  font: Font,
  closure: readonly FileFact[],
  context: InternalVersionWork,
): Promise<void> {
  const wanted = [
    { path: font.file, sha256: font.fileSha256 },
    { path: font.coverage, sha256: font.coverageSha256 },
    { path: font.licenseFile, sha256: font.licenseSha256 },
  ];
  for (const f of wanted) {
    const matches = closure.filter(
      (c) => c.path === `public${f.path}` && c.sha256 === f.sha256,
    );
    if (
      matches.length !== 1 ||
      !/^\/assets\/fonts\/[a-zA-Z0-9_./-]+$/.test(f.path) ||
      f.path.split("/").includes("..") ||
      f.path.includes("//") ||
      matches[0]!.bytes < 1 ||
      matches[0]!.bytes > 8388608 ||
      (f.path === font.file && matches[0]!.bytes !== font.bytes)
    )
      throw unavailable();
    await verifyFile(matches[0]!, context);
  }
}
async function verifyFile(f: FileFact, context: InternalVersionWork) {
  const expires = performance.now() + 5000;
  const checkpoint = () => {
    context.checkpoint();
    if (performance.now() >= expires) {
      context.timeout();
      throw new StudioError("PREVIEW_TIMEOUT");
    }
  };
  const timer = setTimeout(() => context.timeout(), 5000);
  timer.unref?.();
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const parts = f.path.split("/");
    if (
      parts[0] !== "public" ||
      parts.some((p) => !p || p === ".." || p === ".")
    )
      throw unavailable();
    const root = path.join(/* turbopackIgnore: true */ process.cwd(), "public");
    for (let i = 1; i < parts.length; i++) {
      checkpoint();
      const s = await lstat(path.join(root, ...parts.slice(1, i)));
      checkpoint();
      if (!s.isDirectory() || s.isSymbolicLink()) throw unavailable();
    }
    const file = path.join(root, ...parts.slice(1));
    checkpoint();
    const before = await lstat(file);
    checkpoint();
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      before.size !== f.bytes
    )
      throw unavailable();
    // Keep the real open promise; cancellation cannot discard a late FD.
    handle = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    checkpoint();
    const opened = await handle.stat();
    checkpoint();
    if (!opened.isFile() || !same(before, opened)) throw unavailable();
    const buffer = Buffer.alloc(Math.min(65536, f.bytes + 1)),
      hash = createHash("sha256");
    let count = 0;
    for (;;) {
      checkpoint();
      const part = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, f.bytes + 1 - count),
        count,
      );
      checkpoint();
      if (!part.bytesRead) break;
      count += part.bytesRead;
      hash.update(buffer.subarray(0, part.bytesRead));
      if (count > f.bytes) throw unavailable();
    }
    const after = await handle.stat();
    checkpoint();
    const current = await lstat(file);
    checkpoint();
    if (
      count !== f.bytes ||
      !after.isFile() ||
      !current.isFile() ||
      !same(opened, after) ||
      !same(after, current) ||
      hash.digest("hex") !== f.sha256
    )
      throw unavailable();
  } catch (error) {
    if (error instanceof StudioError) throw error;
    throw unavailable();
  } finally {
    try {
      if (handle) {
        try {
          await handle.close();
        } catch {
          context.quarantine(handle);
          throw unavailable();
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
