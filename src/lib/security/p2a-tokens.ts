import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export type TokenKind = "credential" | "preauth" | "session";
export type CsrfKind = Exclude<TokenKind, "credential">;
const prefixes: Record<TokenKind, string> = {
  credential: "qfo_p2a_",
  preauth: "qfp_p2a_",
  session: "qfs_p2a_",
};

export function parseToken(raw: string, kind: TokenKind): Buffer | null {
  const prefix = prefixes[kind];
  if (typeof raw !== "string" || !raw.startsWith(prefix)) return null;
  const encoded = raw.slice(prefix.length);
  if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) return null;
  const bytes = Buffer.from(encoded, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === encoded
    ? bytes
    : null;
}

export function digestToken(raw: string, kind: TokenKind): string | null {
  const bytes = parseToken(raw, kind);
  return bytes
    ? createHash("sha256")
        .update(`quizforge.p2a.token.v1:${kind}:`, "utf8")
        .update(bytes)
        .digest("hex")
    : null;
}

export function issueToken(kind: TokenKind): { raw: string; digest: string } {
  const raw = prefixes[kind] + randomBytes(32).toString("base64url");
  return { raw, digest: digestToken(raw, kind)! };
}

export function csrfForToken(raw: string, kind: CsrfKind): string | null {
  const bytes = parseToken(raw, kind);
  return bytes
    ? createHmac("sha256", bytes)
        .update(`quizforge.p2a.csrf.v1:${kind}`, "utf8")
        .digest("base64url")
    : null;
}

export function verifyCsrf(raw: string, kind: CsrfKind, csrf: string): boolean {
  const expected = csrfForToken(raw, kind);
  if (
    !expected ||
    typeof csrf !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(csrf)
  )
    return false;
  const actual = Buffer.from(csrf, "base64url");
  return (
    actual.length === 32 &&
    actual.toString("base64url") === csrf &&
    timingSafeEqual(Buffer.from(expected, "base64url"), actual)
  );
}
