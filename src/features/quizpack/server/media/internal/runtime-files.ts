import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
export class MediaPolicyError extends Error {
  constructor(
    readonly code:
      | "UNSUPPORTED_PLATFORM"
      | "ISOLATION_UNAVAILABLE"
      | "BUSY"
      | "STOP_UNCONFIRMED",
  ) {
    super(code);
  }
}
export const hashBytes = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");
/** Fixed metadata role; callers cannot turn this into an unbounded read. */
export function readRuntimeMetadata(
  path: string,
  checkpoint: () => void,
): Buffer {
  checkpoint();
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > 16 * 1024)
      throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
    const bytes = Buffer.alloc(16 * 1024 + 1);
    let total = 0;
    for (;;) {
      checkpoint();
      const n = readSync(fd, bytes, total, bytes.length - total, null);
      if (!n) break;
      total += n;
      if (total > before.size)
        throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
    }
    const after = fstatSync(fd);
    if (
      total !== before.size ||
      before.ino !== after.ino ||
      before.dev !== after.dev ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    )
      throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
    checkpoint();
    return bytes.subarray(0, total);
  } finally {
    closeSync(fd);
  }
}
export function hashFile(
  path: string,
  checkpoint: () => void = () => {},
): string {
  checkpoint();
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > 128 * 1024 * 1024)
      throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
    const hash = createHash("sha256"),
      chunk = Buffer.alloc(64 * 1024);
    let total = 0;
    for (;;) {
      checkpoint();
      const n = readSync(fd, chunk, 0, chunk.length, null);
      if (!n) break;
      total += n;
      if (total > before.size)
        throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
      hash.update(chunk.subarray(0, n));
    }
    const after = fstatSync(fd);
    if (
      total !== before.size ||
      before.ino !== after.ino ||
      before.dev !== after.dev ||
      before.mtimeMs !== after.mtimeMs ||
      before.size !== after.size
    )
      throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
    checkpoint();
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}
export function hashTree(
  root: string,
  checkpoint: () => void = () => {},
): string {
  const entries: { path: string; hash: string }[] = [];
  let count = 0,
    bytes = 0;
  function walk(path: string, relative: string) {
    checkpoint();
    for (const name of readdirSync(path).sort()) {
      if (++count > 2048) throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
      const full = join(path, name),
        st = lstatSync(full);
      if (st.isSymbolicLink())
        throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
      if (st.isDirectory()) walk(full, `${relative}${name}/`);
      else if (st.isFile()) {
        bytes += st.size;
        if (bytes > 128 * 1024 * 1024)
          throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
        entries.push({
          path: `${relative}${name}`,
          hash: hashFile(full, checkpoint),
        });
      } else throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
    }
  }
  walk(root, "");
  return hashBytes(JSON.stringify(entries));
}
/** Only this fixed module directory is inventoried; requests cannot add roles or roots. */
export function mediaSourceIdentity(
  checkoutRoot: string,
  checkpoint: () => void,
): readonly { role: string; sha256: string }[] {
  const base = join(checkoutRoot, "src/features/quizpack/server/media");
  const roles: { role: string; sha256: string }[] = [];
  let count = 0,
    total = 0;
  function walk(path: string, prefix: string) {
    checkpoint();
    for (const name of readdirSync(path).sort()) {
      if (++count > 128) throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
      const full = join(path, name),
        st = lstatSync(full);
      if (st.isSymbolicLink())
        throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
      if (st.isDirectory()) walk(full, `${prefix}${name}/`);
      else if (st.isFile()) {
        if (name.endsWith(".test.ts") || name.endsWith(".d.mts")) continue;
        if (!/\.(?:ts|mjs|c|h|json)$/.test(name))
          throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
        total += st.size;
        if (total > 2 * 1024 * 1024)
          throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
        roles.push({
          role: `${prefix}${name}`,
          sha256: hashFile(full, checkpoint),
        });
      } else throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
    }
  }
  walk(base, "");
  return Object.freeze(roles.map((role) => Object.freeze(role)));
}
