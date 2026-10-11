import "server-only";
import { StudioError } from "@/lib/http-security/errors";

export const PREAUTH_COOKIE = "qf_local_p2a_preauth";
export const SESSION_COOKIE = "qf_local_p2a_session";
export const cookieOptions = {
  httpOnly: true,
  sameSite: "strict" as const,
  path: "/",
  secure: false,
};

export function cookieToken(
  headers: Headers,
  kind: "preauth" | "session",
): string | null {
  const name = kind === "preauth" ? PREAUTH_COOKIE : SESSION_COOKIE;
  const values = (headers.get("cookie") ?? "").split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    return separator >= 0 && part.slice(0, separator).trim() === name
      ? [part.slice(separator + 1).trim()]
      : [];
  });
  if (values.length > 1) throw new StudioError("INVALID_REQUEST");
  return values[0] || null;
}
