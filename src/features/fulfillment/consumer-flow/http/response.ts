import "server-only";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  ConsumerError,
  CONSUMER_ERROR_STATUS,
  consumerErrorFact,
} from "@/lib/consumer-contract/v1/errors";
import { canonicalOrdinaryJson } from "@/lib/json/canonical";

export const consumerPrivateHeaders = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
});
/** Caller validates an operation-specific strict DTO first; never serialize service wrappers or faults. */
export function consumerJsonResponse(
  value: unknown,
  status: number,
  maximum: number,
  extra: Readonly<{ "Set-Cookie"?: string }> = {},
) {
  let text: string;
  try {
    text = canonicalOrdinaryJson(value, {
      maxBytes: maximum,
      maxDepth: L.depth,
    });
  } catch {
    throw new ConsumerError("UNAVAILABLE");
  }
  const headers = new Headers({
    ...consumerPrivateHeaders,
    "Content-Type": "application/json; charset=utf-8",
  });
  // Runtime callers can carry wider objects than the TypeScript annotation.
  // Only this explicitly selected header may cross the response boundary.
  if (Object.hasOwn(extra, "Set-Cookie")) {
    const cookie = extra["Set-Cookie"];
    if (
      typeof cookie !== "string" ||
      cookie.length > 4096 ||
      !/^[\x20-\x7e]+$/.test(cookie)
    )
      throw new ConsumerError("UNAVAILABLE");
    headers.set("Set-Cookie", cookie);
  }
  return new Response(text, { status, headers });
}
export function consumerFailureResponse(
  error: unknown,
  requestId: string,
  write: boolean,
) {
  const fact = consumerErrorFact(error, requestId);
  if (!write && fact.code === "OUTCOME_UNKNOWN") fact.code = "UNAVAILABLE";
  return consumerJsonResponse(
    fact,
    CONSUMER_ERROR_STATUS[fact.code],
    L.errorResponseBytes,
  );
}
