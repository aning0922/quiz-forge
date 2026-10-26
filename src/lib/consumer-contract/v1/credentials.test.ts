import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { csrfForToken, digestToken } from "@/lib/security/p2a-tokens";
import {
  createConsumerToken,
  parseConsumerToken,
  digestConsumerToken,
  consumerCsrfForGrant,
  verifyConsumerCsrf,
} from "./credentials";

// Codec-only zero bytes never registered as a credential in a database.
const payload = "A".repeat(43);
const access = `qfk_p4_${payload}`,
  grant = `qfg_p4_${payload}`;
describe("consumer credentials remain separate from selectors and Studio sessions", () => {
  it("creates canonical 32-byte opaque tokens for the two distinct purposes", () => {
    for (const kind of ["access-key", "grant"] as const) {
      const raw = createConsumerToken(kind);
      expect(raw.length === 50).toBe(true);
      expect(parseConsumerToken(raw, kind)?.length === 32).toBe(true);
      expect(
        parseConsumerToken(raw, kind === "grant" ? "access-key" : "grant"),
      ).toBeNull();
    }
  });
  it("rejects whitespace, padding, aliases in unused base64 bits, wrong kind and wrong shape", () => {
    for (const bad of [
      null,
      {},
      "",
      `${access}\n`,
      `${access}=`,
      ` ${access}`,
      `qfk_p4_${"A".repeat(42)}B`,
      grant,
      "a".repeat(64),
    ])
      expect(parseConsumerToken(bad, "access-key")).toBeNull();
    expect(parseConsumerToken(access, "other" as "access-key")).toBeNull();
  });
  it("hashes binary key bytes in an exact independent purpose domain", async () => {
    const expected = createHash("sha256")
      .update("quizforge.p4.token.v1:access-key:", "utf8")
      .update(Buffer.alloc(32))
      .digest("hex");
    expect(await digestConsumerToken(access, "access-key")).toBe(expected);
    expect(await digestConsumerToken(grant, "grant")).not.toBe(expected);
    expect(await digestConsumerToken(access, "grant")).toBeNull();
    expect(digestToken(access, "preauth")).toBeNull();
    expect(digestToken(grant, "session")).toBeNull();
  });
  it("uses the declared HMAC bytes and refuses an access key as a grant", async () => {
    const expected = createHmac("sha256", Buffer.alloc(32))
      .update("quizforge.p4.csrf.v1:consumer-grant", "utf8")
      .digest("base64url");
    expect(await consumerCsrfForGrant(grant)).toBe(expected);
    expect(await consumerCsrfForGrant(access)).toBeNull();
    expect(await verifyConsumerCsrf(grant, expected)).toBe(true);
  });
  it("does not reuse old Studio CSRF, another grant or a noncanonical signature", async () => {
    const csrf = await consumerCsrfForGrant(grant);
    const legacy = csrfForToken(`qfs_p2a_${payload}`, "session");
    expect(await verifyConsumerCsrf(grant, legacy)).toBe(false);
    expect(await verifyConsumerCsrf(createConsumerToken("grant"), csrf)).toBe(
      false,
    );
    expect(await verifyConsumerCsrf(grant, `${csrf}=`)).toBe(false);
    expect(await verifyConsumerCsrf(grant, "A".repeat(42) + "B")).toBe(false);
    expect(await verifyConsumerCsrf(access, csrf)).toBe(false);
  });
  it("does not fall back to weak randomness when cryptographic primitives are absent", () => {
    vi.stubGlobal("crypto", undefined);
    try {
      expect(() => createConsumerToken("access-key")).toThrow(
        "CONSUMER_CRYPTO_UNAVAILABLE",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
