import { createHash } from "node:crypto";
import type { z } from "zod";
import {
  SCORING_API_LIMITS,
  scoringIssueSchema,
  type ScoringErrorCode,
  type ScoringIssue,
  type ScoringResult,
} from "@/lib/assessment-contract/scoring-api-v1";
import {
  CanonicalJsonError,
  canonicalOrdinaryJson,
} from "@/lib/json/canonical";

export function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function failure<T = never>(
  code: ScoringErrorCode,
  path: ScoringIssue["path"] = [],
): ScoringResult<T> {
  return freeze({
    ok: false,
    issues: [{ code, path: [...path] }],
    issuesTruncated: false,
  });
}
export function canonical(
  value: unknown,
  maxBytes = SCORING_API_LIMITS.definitionBytes,
) {
  return canonicalOrdinaryJson(value, {
    maxBytes,
    maxDepth: SCORING_API_LIMITS.depth,
  });
}
export function digest(
  value: unknown,
  domain = "",
  maxBytes = SCORING_API_LIMITS.definitionBytes,
) {
  return createHash("sha256")
    .update(domain)
    .update(canonical(value, maxBytes), "utf8")
    .digest("hex");
}
export function snapshot(
  input: unknown,
  maxBytes: number,
  invalidCode: ScoringErrorCode,
): ScoringResult<unknown> {
  try {
    return {
      ok: true,
      value: JSON.parse(canonical(input, maxBytes)) as unknown,
    };
  } catch (error) {
    return failure(
      error instanceof CanonicalJsonError &&
        ["JSON_SIZE_LIMIT", "JSON_DEPTH_LIMIT"].includes(error.code)
        ? "INPUT_LIMIT_EXCEEDED"
        : invalidCode,
    );
  }
}
export function shapeFailure<T>(
  error: z.ZodError,
  code: ScoringErrorCode,
): ScoringResult<T> {
  const issues = error.issues
    .slice(0, SCORING_API_LIMITS.issues)
    .map((issue) => ({
      code,
      path: issue.path
        .filter(
          (part): part is ScoringIssue["path"][number] =>
            (typeof part === "string" || typeof part === "number") &&
            scoringIssueSchema.shape.path.element.safeParse(part).success,
        )
        .slice(0, SCORING_API_LIMITS.depth),
    }));
  return freeze({
    ok: false,
    issues,
    issuesTruncated: error.issues.length > issues.length,
  });
}
export function output<T>(
  schema: z.ZodType<T>,
  value: unknown,
  maxBytes: number,
): ScoringResult<T> {
  // Only internally constructed ordinary values reach this boundary. Check the
  // complete actual wire representation, not a sum of individual field budgets.
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > maxBytes)
    return failure("INPUT_LIMIT_EXCEEDED");
  return freeze({ ok: true, value: schema.parse(value) });
}

export class Issues {
  readonly items: ScoringIssue[] = [];
  truncated = false;
  add(code: ScoringErrorCode, path: ScoringIssue["path"]) {
    if (this.items.length < SCORING_API_LIMITS.issues)
      this.items.push({ code, path: [...path] });
    else this.truncated = true;
  }
  result<T>(): ScoringResult<T> {
    return freeze({
      ok: false,
      issues: this.items,
      issuesTruncated: this.truncated,
    });
  }
}
