import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";
import { dirname } from "node:path";
import { TextDecoder } from "node:util";
import { z } from "zod";
import { MediaPolicyError } from "./runtime-files";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const mediaCapabilitySchema = z.strictObject({
  schema: z.literal("quizpack-media-capability.v1"),
  platform: z.enum(["darwin-arm64", "linux-x64"]),
  componentId: hash,
  deploymentId: hash,
  runtimeBundleHash: hash,
  limitsHash: hash,
  profileId: hash,
});
export type MediaCapability = Readonly<z.infer<typeof mediaCapabilitySchema>>;
/** Ordinary runtime is read-only. Offline sealing writes this fixed private role. */
export function readMediaCapability(
  path: string,
  checkpoint: () => void,
): MediaCapability {
  checkpoint();
  const directory = lstatSync(dirname(path));
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    directory.uid !== process.getuid?.() ||
    (directory.mode & 0o777) !== 0o700
  )
    throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(fd);
    if (
      !before.isFile() ||
      before.uid !== process.getuid?.() ||
      before.nlink !== 1 ||
      (before.mode & 0o777) !== 0o600 ||
      before.size > 16 * 1024
    )
      throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
    const bytes = Buffer.alloc(16 * 1024 + 1);
    let total = 0;
    for (;;) {
      checkpoint();
      const n = readSync(fd, bytes, total, bytes.length - total, null);
      if (!n) break;
      total += n;
      if (total > 16 * 1024)
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
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes.subarray(0, total));
    const value: unknown = JSON.parse(text);
    const parsed = mediaCapabilitySchema.safeParse(value);
    // Every accepted string is a fixed token/hash; whitespace outside JSON is harmless.
    if (
      !parsed.success ||
      JSON.stringify(value) !== text.replace(/[ \t\r\n]/g, "")
    )
      throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
    checkpoint();
    return Object.freeze(parsed.data);
  } finally {
    closeSync(fd);
  }
}
