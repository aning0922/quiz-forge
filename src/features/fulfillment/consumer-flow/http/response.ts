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
  return new Response(text, {
    status,
    headers: {
      ...consumerPrivateHeaders,
      ...extra,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
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
