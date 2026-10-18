/** Browser/Node WebCrypto codec only. Parsed bytes/digests never grant database authority. */
export type ConsumerTokenKind = "access-key" | "grant";
const prefixes = Object.freeze({ "access-key": "qfk_p4_", grant: "qfg_p4_" });
const csrfDomain = "quizforge.p4.csrf.v1:consumer-grant";
const tokenDomain = (kind: ConsumerTokenKind) =>
  `quizforge.p4.token.v1:${kind}:`;
const unavailable = () => Error("CONSUMER_CRYPTO_UNAVAILABLE");
function validKind(kind: ConsumerTokenKind): boolean {
  return kind === "access-key" || kind === "grant";
}
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function decode32(value: unknown): Uint8Array | null {
  if (
    typeof value !== "string" ||
    value.length !== 43 ||
    !/^[A-Za-z0-9_-]{43}$/.test(value)
  )
    return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=");
    if (binary.length !== 32) return null;
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return encode(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}
export function parseConsumerToken(
  raw: unknown,
  kind: ConsumerTokenKind,
): Uint8Array | null {
  if (
    !validKind(kind) ||
    typeof raw !== "string" ||
    raw.length !== 50 ||
    !raw.startsWith(prefixes[kind])
  )
    return null;
  return decode32(raw.slice(prefixes[kind].length));
}
/** Call in the operator browser only for access-key; grant issuance belongs to the server. */
export function createConsumerToken(kind: ConsumerTokenKind): string {
  if (!validKind(kind)) throw Error("CONSUMER_TOKEN_KIND_INVALID");
  if (!globalThis.crypto?.getRandomValues) throw unavailable();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return prefixes[kind] + encode(bytes);
}
export async function digestConsumerToken(
  raw: unknown,
  kind: ConsumerTokenKind,
): Promise<string | null> {
  const bytes = parseConsumerToken(raw, kind);
  if (!bytes) return null;
  if (!globalThis.crypto?.subtle) throw unavailable();
  const domain = new TextEncoder().encode(tokenDomain(kind));
  const input = new Uint8Array(domain.length + bytes.length);
  input.set(domain);
  input.set(bytes, domain.length);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
async function csrfKey(bytes: Uint8Array, usage: "sign" | "verify") {
  if (!globalThis.crypto?.subtle) throw unavailable();
  return globalThis.crypto.subtle.importKey(
    "raw",
    new Uint8Array(bytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}
/** Server derives this from the current HttpOnly grant; clients receive only the CSRF value. */
export async function consumerCsrfForGrant(
  raw: unknown,
): Promise<string | null> {
  const bytes = parseConsumerToken(raw, "grant");
  if (!bytes) return null;
  const key = await csrfKey(bytes, "sign");
  return encode(
    new Uint8Array(
      await globalThis.crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(csrfDomain),
      ),
    ),
  );
}
export async function verifyConsumerCsrf(
  raw: unknown,
  csrf: unknown,
): Promise<boolean> {
  const bytes = parseConsumerToken(raw, "grant"),
    signature = decode32(csrf);
  if (!bytes || !signature) return false;
  const key = await csrfKey(bytes, "verify");
  return globalThis.crypto.subtle.verify(
    "HMAC",
    key,
    new Uint8Array(signature),
    new TextEncoder().encode(csrfDomain),
  );
}
export const CONSUMER_COOKIE_NAME_V1 = "qf_local_consumer_grant_v1";
export const CONSUMER_EXCHANGE_HEADER_V1 = "x-quizforge-consumer-exchange";
export const CONSUMER_EXCHANGE_HEADER_VALUE_V1 = "1";
