import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  csrfForToken,
  digestToken,
  issueToken,
  parseToken,
  verifyCsrf,
} from "./p2a-tokens";

describe("P2-A token contract", () => {
  it("hashes decoded bytes with the versioned kind domain", () => {
    const bytes = Buffer.alloc(32, 7);
    const raw = `qfs_p2a_${bytes.toString("base64url")}`;
    expect(digestToken(raw, "session")).toBe(
      createHash("sha256")
        .update("quizforge.p2a.token.v1:session:")
        .update(bytes)
        .digest("hex"),
    );
    expect(digestToken(raw, "preauth")).toBeNull();
  });
  it.each(["preauth", "session"] as const)(
    "issues independent canonical %s tokens",
    (kind) => {
      const first = issueToken(kind);
      expect(parseToken(first.raw, kind)).toHaveLength(32);
      expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(first.digest).toBe(digestToken(first.raw, kind));
      expect(issueToken(kind).raw).not.toBe(first.raw);
      for (const other of ["preauth", "session"] as const)
        if (kind !== other) expect(parseToken(first.raw, other)).toBeNull();
    },
  );
  it("rejects whitespace, padding, noncanonical trailing bits and wrong lengths", () => {
    const canonical = `qfs_p2a_${Buffer.alloc(32).toString("base64url")}`;
    for (const raw of [
      "",
      canonical + "=",
      " " + canonical,
      canonical + "\n",
      canonical.slice(0, -1),
      canonical.slice(0, -1) + "B",
      canonical.replace("qfs", "qfp"),
      canonical.replace("qfs", "qfo"),
    ]) {
      expect(parseToken(raw, "session")).toBeNull();
      expect(digestToken(raw, "session")).toBeNull();
      expect(csrfForToken(raw, "session")).toBeNull();
    }
  });
  it("binds CSRF to cookie bytes and kind and rejects malformed headers", () => {
    const first = issueToken("preauth");
    const csrf = csrfForToken(first.raw, "preauth")!;
    expect(csrf).toBe(
      createHmac("sha256", parseToken(first.raw, "preauth")!)
        .update("quizforge.p2a.csrf.v1:preauth")
        .digest("base64url"),
    );
    expect(verifyCsrf(first.raw, "preauth", csrf)).toBe(true);
    expect(verifyCsrf(issueToken("preauth").raw, "preauth", csrf)).toBe(false);
    expect(verifyCsrf(first.raw.replace("qfp", "qfs"), "session", csrf)).toBe(
      false,
    );
    for (const header of [
      csrf + "=",
      csrf + "\n",
      "",
      "a".repeat(44),
      csrf.slice(0, -1),
    ])
      expect(verifyCsrf(first.raw, "preauth", header)).toBe(false);
  });
});
