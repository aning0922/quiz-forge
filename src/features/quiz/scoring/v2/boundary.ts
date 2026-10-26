import { createHash } from "node:crypto";
import type { z } from "zod";
import { canonicalOrdinaryJson } from "@/lib/json/canonical";
import type {
  V2ErrorCode,
  V2Result,
} from "@/lib/assessment-contract/scoring-api-v2";
import { SCORING_LIMITS_V2 } from "@/lib/assessment-contract/scoring-v2";

export function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function failure(
  code: V2ErrorCode,
): Extract<V2Result<never>, { ok: false }> {
  return freeze({ ok: false, issues: [{ code }] });
}
export function canonicalV2(
  value: unknown,
  maxBytes = SCORING_LIMITS_V2.definitionBytes,
) {
  return canonicalOrdinaryJson(value, { maxBytes, maxDepth: 32 });
}
export function digestV2(domain: string, value: unknown) {
  return createHash("sha256")
    .update(`quizforge:${domain}\n`)
    .update(canonicalV2(value), "utf8")
    .digest("hex");
}
export function parseBounded<T>(
  schema: z.ZodType<T>,
  input: unknown,
  code: V2ErrorCode,
  maximum = SCORING_LIMITS_V2.definitionBytes,
): V2Result<T> {
  try {
    const parsed = schema.safeParse(JSON.parse(canonicalV2(input, maximum)));
    return parsed.success
      ? freeze({ ok: true, value: parsed.data })
      : failure(code);
  } catch {
    return failure(code);
  }
}
export const refKey = (ref: {
  productId: string;
  id: string;
  version: string;
}) => JSON.stringify([ref.productId, ref.id, ref.version]);

/** Exact integer rounding, including negative halves; denominator is positive. */
export function roundEven(numerator: bigint, denominator: bigint): bigint {
  const zero = BigInt(0),
    one = BigInt(1),
    two = BigInt(2);
  if (denominator <= zero) throw Error("INVALID_DENOMINATOR");
  const sign = numerator < zero ? -one : one;
  const n = numerator * sign;
  const quotient = n / denominator;
  const remainder = n % denominator;
  const up =
    remainder * two > denominator ||
    (remainder * two === denominator && quotient % two === one);
  return sign * (quotient + (up ? one : zero));
}
export function fraction(n: number, d: number) {
  let a = n,
    b = d;
  while (b) [a, b] = [b, a % b];
  return { numerator: String(n / a), denominator: String(d / a) };
}
