import { TextDecoder } from "node:util";
import { z } from "zod";
import { imageMediaTypeSchema } from "../../../src/features/quizpack/v1/manifest";
import {
  MEDIA_LIMITS,
  type ImageDeclaration,
  type ImageFacts,
} from "./contracts";
const factsSchema = z.strictObject({
  ok: z.literal(true),
  mediaType: imageMediaTypeSchema,
  width: z.number().int().positive().max(MEDIA_LIMITS.dimension),
  height: z.number().int().positive().max(MEDIA_LIMITS.dimension),
  frames: z.literal(1),
  mediaDecoded: z.literal(true),
});
const rejectedSchema = z.strictObject({
  ok: z.literal(false),
  code: z.enum([
    "MEDIA_FORMAT_MISMATCH",
    "MEDIA_ANIMATED",
    "MEDIA_LIMIT",
    "MEDIA_DECODE_FAILED",
  ]),
});
export function parseWorkerOutput(
  bytes: Uint8Array,
  expected: ImageDeclaration,
):
  | { ok: true; facts: ImageFacts }
  | { ok: false; code: "DECODE_REJECTED" | "OUTPUT_INVALID" } {
  try {
    if (bytes.byteLength > MEDIA_LIMITS.stdoutBytes)
      return { ok: false, code: "OUTPUT_INVALID" };
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(text);
    // Canonical worker output disallows duplicate keys, whitespace, trailing data and alternate encodings.
    if (JSON.stringify(value) !== text)
      return { ok: false, code: "OUTPUT_INVALID" };
    const parsed = factsSchema.safeParse(value);
    if (!parsed.success)
      return {
        ok: false,
        code: rejectedSchema.safeParse(value).success
          ? "DECODE_REJECTED"
          : "OUTPUT_INVALID",
      };
    const facts: ImageFacts = {
      mediaType: parsed.data.mediaType,
      width: parsed.data.width,
      height: parsed.data.height,
      frames: 1,
      mediaDecoded: true,
    };
    if (
      facts.width * facts.height > MEDIA_LIMITS.pixels ||
      facts.mediaType !== expected.mediaType ||
      facts.width !== expected.width ||
      facts.height !== expected.height
    )
      return { ok: false, code: "DECODE_REJECTED" };
    return { ok: true, facts };
  } catch {
    return { ok: false, code: "OUTPUT_INVALID" };
  }
}
