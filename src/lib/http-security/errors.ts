import "server-only";

export type StudioErrorCode =
  | "INVALID_REQUEST"
  | "PAYLOAD_TOO_LARGE"
  | "AUTHENTICATION_FAILED"
  | "UNAUTHENTICATED"
  | "ORIGIN_REJECTED"
  | "CSRF_REJECTED"
  | "CAPABILITY_DENIED"
  | "ALREADY_AUTHENTICATED"
  | "RATE_LIMITED"
  | "PRODUCT_NOT_FOUND"
  | "TAXONOMY_NOT_FOUND"
  | "PRODUCT_ID_CONFLICT"
  | "SLUG_CONFLICT"
  | "METADATA_REVISION_CONFLICT"
  | "TAXONOMY_REVISION_CONFLICT"
  | "PRODUCT_ARCHIVED"
  | "TAXONOMY_ARCHIVED"
  | "TAG_LIMIT_EXCEEDED"
  | "REVISION_LIMIT"
  | "WRITE_BUSY"
  | "WRITE_OUTCOME_UNKNOWN"
  | "STUDIO_UNAVAILABLE";

const statuses: Record<StudioErrorCode, number> = {
  INVALID_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  AUTHENTICATION_FAILED: 401,
  UNAUTHENTICATED: 401,
  ORIGIN_REJECTED: 403,
  CSRF_REJECTED: 403,
  CAPABILITY_DENIED: 403,
  ALREADY_AUTHENTICATED: 409,
  RATE_LIMITED: 429,
  PRODUCT_NOT_FOUND: 404,
  TAXONOMY_NOT_FOUND: 404,
  PRODUCT_ID_CONFLICT: 409,
  SLUG_CONFLICT: 409,
  METADATA_REVISION_CONFLICT: 409,
  TAXONOMY_REVISION_CONFLICT: 409,
  PRODUCT_ARCHIVED: 409,
  TAXONOMY_ARCHIVED: 409,
  TAG_LIMIT_EXCEEDED: 400,
  REVISION_LIMIT: 409,
  WRITE_BUSY: 409,
  WRITE_OUTCOME_UNKNOWN: 503,
  STUDIO_UNAVAILABLE: 503,
};

export class StudioError extends Error {
  constructor(
    readonly code: StudioErrorCode,
    readonly currentRevision?: number,
  ) {
    super(code);
    this.name = "StudioError";
  }
}

export const privateHeaders = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export function errorResponse(error: unknown, requestId: string): Response {
  const code = error instanceof StudioError ? error.code : "STUDIO_UNAVAILABLE";
  return Response.json(
    {
      code,
      requestId,
      ...(error instanceof StudioError &&
      (code === "METADATA_REVISION_CONFLICT" ||
        code === "TAXONOMY_REVISION_CONFLICT") &&
      Number.isInteger(error.currentRevision) &&
      error.currentRevision! > 0 &&
      error.currentRevision! <= 2147483647
        ? { currentRevision: error.currentRevision }
        : {}),
    },
    {
      status: statuses[code],
      headers: {
        ...privateHeaders,
        ...(code === "RATE_LIMITED" ? { "Retry-After": "60" } : {}),
      },
    },
  );
}
