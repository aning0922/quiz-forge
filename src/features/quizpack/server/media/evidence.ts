import { TextDecoder } from "node:util";
import { z } from "zod";
import {
  LAUNCH_FAILURE_CODES,
  MEDIA_LIMITS,
  type LaunchResult,
  type MediaEvidenceParseResult,
  type MediaRuntimeBinding,
} from "./contracts";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const mediaRuntimeBindingSchema = z.strictObject({
  schema: z.literal("quizpack-media-runtime-binding.v1"),
  platform: z.enum(["darwin-arm64", "linux-x64"]),
  componentId: hash,
  deploymentId: hash,
  runtimeBundleHash: hash,
  limitsHash: hash,
});
const factsSchema = z
  .strictObject({
    mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    width: z.number().int().positive().max(MEDIA_LIMITS.dimension),
    height: z.number().int().positive().max(MEDIA_LIMITS.dimension),
    frames: z.literal(1),
    mediaDecoded: z.literal(true),
  })
  .refine((facts) => facts.width * facts.height <= MEDIA_LIMITS.pixels);
export const launchResultSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("decoded"),
    runId: z.string().uuid(),
    profileId: hash,
    facts: factsSchema,
    stopped: z.literal("confirmed"),
  }),
  z
    .strictObject({
      outcome: z.literal("failed"),
      runId: z.string().uuid(),
      profileId: hash.nullable(),
      code: z.enum(LAUNCH_FAILURE_CODES),
      stopped: z.enum(["not-started", "confirmed", "unknown"]),
    })
    .refine(
      (result) =>
        (result.stopped === "unknown") === (result.code === "STOP_UNCONFIRMED"),
    ),
]);

export const MEDIA_EVIDENCE_LIMITS = Object.freeze({
  runtimeBindingBytes: 1024,
  launchResultBytes: 2048,
});
function parseBounded<T>(
  input: Uint8Array,
  limit: number,
  schema: z.ZodType<T>,
): MediaEvidenceParseResult<T> {
  try {
    if (
      !(input instanceof Uint8Array) ||
      input.buffer instanceof SharedArrayBuffer ||
      input.byteLength > limit
    )
      return { ok: false, code: "INVALID_MEDIA_EVIDENCE" };
    const bytes = Buffer.from(input);
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    const raw: unknown = JSON.parse(text);
    // One exact JSON serialization rejects duplicate keys, BOM and trailing data.
    if (JSON.stringify(raw) !== text)
      return { ok: false, code: "INVALID_MEDIA_EVIDENCE" };
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return { ok: false, code: "INVALID_MEDIA_EVIDENCE" };
    return { ok: true, value: Object.freeze(parsed.data) };
  } catch {
    return { ok: false, code: "INVALID_MEDIA_EVIDENCE" };
  }
}
export function parseMediaRuntimeBinding(
  bytes: Uint8Array,
): MediaEvidenceParseResult<MediaRuntimeBinding> {
  return parseBounded(
    bytes,
    MEDIA_EVIDENCE_LIMITS.runtimeBindingBytes,
    mediaRuntimeBindingSchema,
  );
}
export function parseLaunchResult(
  bytes: Uint8Array,
): MediaEvidenceParseResult<LaunchResult> {
  const result = parseBounded(
    bytes,
    MEDIA_EVIDENCE_LIMITS.launchResultBytes,
    launchResultSchema,
  );
  if (result.ok && result.value.outcome === "decoded")
    Object.freeze(result.value.facts);
  return result;
}
