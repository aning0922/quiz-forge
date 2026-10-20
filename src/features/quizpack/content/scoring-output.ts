import type { z } from "zod";
import {
  SCORING_API_LIMITS,
  type ScoringErrorCode,
  type ScoringResult,
} from "@/lib/assessment-contract/scoring-api-v1";
import {
  canonicalOrdinaryJson,
  CanonicalJsonError,
} from "@/lib/json/canonical";
import { freezeContent } from "./supported";

export function contentScoringFailure(
  code: ScoringErrorCode,
): ScoringResult<never> {
  return freezeContent({
    ok: false,
    issues: [{ code, path: [] }],
    issuesTruncated: false,
  });
}
/** Internal serialization boundary, not an execution entry or a trusted score input. */
export function contentScoringOutput<T>(
  schema: z.ZodType<T>,
  value: unknown,
  kind: "score" | "evidence",
): ScoringResult<T> {
  try {
    canonicalOrdinaryJson(
      { ok: true, value },
      {
        maxBytes:
          kind === "score"
            ? SCORING_API_LIMITS.scoreBytes
            : SCORING_API_LIMITS.evidenceBytes,
        maxDepth: SCORING_API_LIMITS.depth,
      },
    );
  } catch (error) {
    return contentScoringFailure(
      error instanceof CanonicalJsonError &&
        ["JSON_SIZE_LIMIT", "JSON_DEPTH_LIMIT"].includes(error.code)
        ? "INPUT_LIMIT_EXCEEDED"
        : "INVALID_DEFINITION",
    );
  }
  const checked = schema.safeParse(value);
  return checked.success
    ? freezeContent({ ok: true, value: checked.data })
    : contentScoringFailure("INVALID_DEFINITION");
}
