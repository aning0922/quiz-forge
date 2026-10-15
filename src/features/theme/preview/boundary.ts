import "server-only";
import {
  canonicalOrdinaryJson,
  CanonicalJsonError,
} from "@/lib/json/canonical";
import { P1CanonicalError } from "@/features/quizpack/v1/canonical";
import { PREVIEW_LIMITS } from "@/features/product/preview/limits";
import type {
  PreviewErrorCode,
  PreviewResult,
} from "@/features/product/preview/contracts";
import { freezeContent } from "@/features/quizpack/content/supported";

export const failure = (code: PreviewErrorCode): PreviewResult<never> =>
  Object.freeze({ ok: false, code });
export function ordinarySnapshot(input: unknown, maxBytes: number): unknown {
  return JSON.parse(
    canonicalOrdinaryJson(input, { maxBytes, maxDepth: PREVIEW_LIMITS.depth }),
  );
}
export function isBoundaryLimit(error: unknown): boolean {
  return (
    (error instanceof CanonicalJsonError ||
      error instanceof P1CanonicalError) &&
    ["JSON_SIZE_LIMIT", "JSON_DEPTH_LIMIT"].includes(error.code)
  );
}
/** Measure the complete success envelope before parsing or publishing any result. */
export function boundedOutput<T>(
  value: unknown,
  maximum: number,
  parse: (value: unknown) => T,
): PreviewResult<T> {
  try {
    canonicalOrdinaryJson(
      { ok: true, value },
      { maxBytes: maximum, maxDepth: PREVIEW_LIMITS.depth },
    );
    return freezeContent({ ok: true, value: parse(value) });
  } catch (error) {
    return failure(
      isBoundaryLimit(error) ? "PREVIEW_LIMIT_EXCEEDED" : "PREVIEW_UNSUPPORTED",
    );
  }
}
