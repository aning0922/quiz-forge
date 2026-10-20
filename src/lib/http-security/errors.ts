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
  STUDIO_UNAVAILABLE: 503,
};

export class StudioError extends Error {
  constructor(readonly code: StudioErrorCode) {
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
    { code, requestId },
    {
      status: statuses[code],
      headers: {
        ...privateHeaders,
        ...(code === "RATE_LIMITED" ? { "Retry-After": "60" } : {}),
      },
    },
  );
}
