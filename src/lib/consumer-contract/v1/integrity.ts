import { canonicalConsumerJson } from "./canonical";
import { CONSUMER_LIMITS_V1 as L } from "./limits";

/** Call only after the version-specific strict Schema, over bounded parsed JSON. */
export function consumerCanonicalText(value: unknown, maximum: number): string {
  return canonicalConsumerJson(value, {
    maxBytes: maximum,
    maxDepth: L.depth,
  });
}
export function withinConsumerBytes(value: unknown, maximum: number): boolean {
  try {
    consumerCanonicalText(value, maximum);
    return true;
  } catch {
    return false;
  }
}
/** Protocol schemaVersion fields separate these canonical facts from older protocols. */
export async function consumerTextSha256(text: string): Promise<string> {
  if (typeof text !== "string" || text.length > 2 * 1024 * 1024)
    throw Error("CONSUMER_FACT_LIMIT_EXCEEDED");
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > 2 * 1024 * 1024)
    throw Error("CONSUMER_FACT_LIMIT_EXCEEDED");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function sameConsumerFact(
  left: unknown,
  right: unknown,
  maximum: number,
): boolean {
  return (
    consumerCanonicalText(left, maximum) ===
    consumerCanonicalText(right, maximum)
  );
}
