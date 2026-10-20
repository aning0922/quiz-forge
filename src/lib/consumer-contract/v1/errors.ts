import { z } from "zod";
import { consumerUuidSchema } from "./primitives";

/** Finite public vocabulary. An error is never evidence that an earlier write did not commit. */
export const CONSUMER_ERROR_STATUS = Object.freeze({
  INVALID_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  SOURCE_REJECTED: 403,
  CSRF_REJECTED: 403,
  ACCESS_DENIED: 401,
  OPERATOR_REQUIRED: 403,
  NOT_FOUND: 404,
  PRODUCT_ARCHIVED: 409,
  SOURCE_OBSOLETE: 409,
  OPERATION_CONFLICT: 409,
  PLAY_LIMIT: 409,
  UNSUPPORTED_IMPLEMENTATION: 422,
  DEPENDENCY_UNAVAILABLE: 503,
  INVALID_ANSWERS: 422,
  STATE_CONFLICT: 409,
  STATE_LIMIT: 409,
  KEY_NOT_ACTIVE: 403,
  KEY_ALREADY_CLAIMED: 409,
  RATE_LIMITED: 429,
  BUSY: 409,
  TIMEOUT: 504,
  OUTCOME_UNKNOWN: 503,
  UNAVAILABLE: 503,
} as const);
export type ConsumerErrorCode = keyof typeof CONSUMER_ERROR_STATUS;
export const consumerErrorCodeSchema = z.enum(
  Object.keys(CONSUMER_ERROR_STATUS) as [
    ConsumerErrorCode,
    ...ConsumerErrorCode[],
  ],
);
export const consumerErrorResponseSchema = z.strictObject({
  schemaVersion: z.literal("quizforge.consumer-error.v1"),
  code: consumerErrorCodeSchema,
  requestId: consumerUuidSchema,
});

/** Do not attach raw credentials, request bodies, SQL faults or arbitrary messages. */
export class ConsumerError extends Error {
  constructor(readonly code: ConsumerErrorCode) {
    super(code);
    this.name = "ConsumerError";
  }
}

export function consumerErrorFact(error: unknown, requestId: string) {
  return consumerErrorResponseSchema.parse({
    schemaVersion: "quizforge.consumer-error.v1",
    code: error instanceof ConsumerError ? error.code : "UNAVAILABLE",
    requestId,
  });
}
