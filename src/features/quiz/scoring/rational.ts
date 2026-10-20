import type { FractionV1 } from "@/lib/assessment-contract/scoring-api-v1";
const ZERO = BigInt(0),
  ONE = BigInt(1);
export function gcd(a: bigint, b: bigint): bigint {
  while (b !== ZERO) [a, b] = [b, a % b];
  return a < ZERO ? -a : a;
}
export function fraction(n: bigint, d: bigint): FractionV1 {
  if (n < ZERO || d <= ZERO) throw new Error("SCORING_ARITHMETIC_INVARIANT");
  const g = gcd(n, d);
  return { numerator: String(n / g), denominator: String(d / g) };
}
export function lcm(a: bigint, b: bigint) {
  return (a / gcd(a, b)) * b;
}
/** quiz-score-display.v1: positive exact normalized score, half-up one decimal. */
export function displayHalfUp(n: bigint, d: bigint): string {
  if (n < ZERO || d <= ZERO || n > BigInt(100) * d)
    throw new RangeError("INVALID_NORMALIZED_SCORE");
  const tenths = (n * BigInt(20) + d) / (BigInt(2) * d);
  return `${tenths / BigInt(10)}.${tenths % BigInt(10)}`;
}
export const UNIT = ONE;
