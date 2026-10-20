import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assetPathSchema,
  imageMediaTypeSchema,
  sha256Schema,
} from "../../../src/features/quizpack/v1/manifest";
import {
  MEDIA_LIMITS,
  type ImageDeclaration,
  type LaunchFailureCode,
} from "./contracts";

// Numbers above policy limits are distinguished from malformed declarations.
const schema = z.strictObject({
  path: assetPathSchema,
  mediaType: imageMediaTypeSchema,
  sha256: sha256Schema,
  bytes: z.number().int().positive().safe(),
  width: z.number().int().positive().safe(),
  height: z.number().int().positive().safe(),
});
export type Precheck =
  | { ok: true; bytes: Buffer; expected: Readonly<ImageDeclaration> }
  | {
      ok: false;
      code: Extract<
        LaunchFailureCode,
        "INVALID_INPUT" | "INPUT_LIMIT" | "DECODE_REJECTED"
      >;
    };

function sniff(bytes: Buffer): ImageDeclaration["mediaType"] | undefined {
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
  return undefined;
}
// Same bounded chunk traversal as P1; integrity of chunks/pixels remains the worker's job.
function animated(bytes: Buffer, type: ImageDeclaration["mediaType"]): boolean {
  if (type === "image/png") {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      if (
        ["acTL", "fcTL", "fdAT"].includes(
          bytes.toString("ascii", offset + 4, offset + 8),
        )
      )
        return true;
      offset += length + 12;
    }
  }
  if (type === "image/webp") {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const type = bytes.toString("ascii", offset, offset + 4);
      const length = bytes.readUInt32LE(offset + 4);
      if (
        type === "ANIM" ||
        type === "ANMF" ||
        (type === "VP8X" && length > 0 && ((bytes[offset + 8] ?? 0) & 2) !== 0)
      )
        return true;
      offset += length + 8 + (length % 2);
    }
  }
  return false;
}
/** Synchronous: callers MUST invoke before their first await or platform operation.
 * The returned Buffer is a private copy; do not expose it outside the launcher. */
export function precheckImage(input: unknown, expected: unknown): Precheck {
  try {
    const parsed = schema.safeParse(expected);
    if (!parsed.success || !(input instanceof Uint8Array))
      return { ok: false, code: "INVALID_INPUT" };
    const d = parsed.data;
    if (
      input.byteLength > MEDIA_LIMITS.bytes ||
      d.bytes > MEDIA_LIMITS.bytes ||
      d.width > MEDIA_LIMITS.dimension ||
      d.height > MEDIA_LIMITS.dimension ||
      d.width * d.height > MEDIA_LIMITS.pixels
    )
      return { ok: false, code: "INPUT_LIMIT" };
    // Reject shared memory: another thread can mutate while a snapshot is being copied.
    if (input.buffer instanceof SharedArrayBuffer)
      return { ok: false, code: "INVALID_INPUT" };
    const bytes = Buffer.from(input);
    if (
      bytes.length !== d.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== d.sha256
    )
      return { ok: false, code: "INVALID_INPUT" };
    const type = sniff(bytes);
    const extension = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
    }[d.mediaType];
    if (type !== d.mediaType || !d.path.endsWith(`.${extension}`))
      return { ok: false, code: "DECODE_REJECTED" };
    if (animated(bytes, type)) return { ok: false, code: "DECODE_REJECTED" };
    return { ok: true, bytes, expected: Object.freeze(d) };
  } catch {
    return { ok: false, code: "INVALID_INPUT" };
  }
}
