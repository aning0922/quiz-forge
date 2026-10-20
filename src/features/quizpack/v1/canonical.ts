import {
  canonicalOrdinaryJson,
  CanonicalJsonError,
} from "@/lib/json/canonical";

/** P1 budgets are independent of F1's unchanged 1MiB serialization contract. */
export const P1_CANONICAL_LIMITS = Object.freeze({
  content: 2 * 1024 * 1024,
  manifest: 512 * 1024,
  depth: 32,
});
export class P1CanonicalError extends Error {
  constructor(public readonly code: string) {
    super("QuizPack canonical JSON rejected.");
  }
}

/** Preserve P1's public budget, ordinary JSON bytes and finite error identity. */
export function canonicalP1Json(
  input: unknown,
  budget: "content" | "manifest" = "content",
): string {
  if (budget !== "content" && budget !== "manifest")
    throw new P1CanonicalError("JSON_INVALID_VALUE");
  try {
    return canonicalOrdinaryJson(input, {
      maxBytes: P1_CANONICAL_LIMITS[budget],
      maxDepth: P1_CANONICAL_LIMITS.depth,
    });
  } catch (error) {
    if (error instanceof CanonicalJsonError)
      throw new P1CanonicalError(error.code);
    throw error;
  }
}
