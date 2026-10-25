/** Browser-safe setup bearer protocol. Raw tokens stay in memory and POST bodies only. */
export const PASSWORD_TOKEN_PREFIX = "qfa_setup_v1_";
export const PASSWORD_TOKEN_CSRF_DOMAIN = "quizforge.accounts.setup.csrf.v1";
export function passwordTokenBytes(raw: unknown): Uint8Array | null {
  if (typeof raw !== "string" || !raw.startsWith(PASSWORD_TOKEN_PREFIX))
    return null;
  const text = raw.slice(PASSWORD_TOKEN_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) return null;
  try {
    const decoded = atob(text.replaceAll("-", "+").replaceAll("_", "/") + "=");
    const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    const encoded = btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    return bytes.length === 32 && encoded === text ? bytes : null;
  } catch {
    return null;
  }
}
/** Send as x-csrf-token; send {token: raw,...} in the bounded JSON POST body. */
export async function passwordSetupCsrf(raw: string): Promise<string | null> {
  const bytes = passwordTokenBytes(raw);
  if (!bytes) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(bytes).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(PASSWORD_TOKEN_CSRF_DOMAIN),
    ),
  );
  return btoa(String.fromCharCode(...signed))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
