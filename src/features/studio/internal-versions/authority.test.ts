import { describe, expect, it } from "vitest";
import { StudioClientError } from "../client";
import { InternalProductAuthority } from "./authority";
describe("stable Product page authority acceptance", () => {
  it.each([
    "UNAUTHENTICATED",
    "CAPABILITY_DENIED",
    "CSRF_REJECTED",
    "ORIGIN_REJECTED",
  ])(
    "%s synchronously invalidates all components' tickets and cannot be reset by a late read",
    (code) => {
      const authority = new InternalProductAuthority("test-product"),
        write = authority.capture(),
        resolve = authority.capture(),
        clear = authority.capture();
      let observed = false;
      const unsubscribe = authority.subscribe(() => {
        observed = true;
        expect(authority.accepts(clear)).toBe(false);
      });
      authority.observe(new StudioClientError(code));
      expect(observed).toBe(true);
      for (const ticket of [write, resolve, clear, authority.capture()])
        expect(authority.accepts(ticket)).toBe(false);
      expect(authority.isRevoked).toBe(true);
      authority.observe(new StudioClientError("STUDIO_UNAVAILABLE"));
      expect(authority.isRevoked).toBe(true);
      unsubscribe();
    },
  );
  it("ordinary503/404/409 and unknown errors do not disable original-key recovery", () => {
    const authority = new InternalProductAuthority("test-product"),
      ticket = authority.capture();
    for (const code of [
      "STUDIO_UNAVAILABLE",
      "DRAFT_REVISION_NOT_FOUND",
      "VERSION_NOT_FOUND",
      "DRAFT_BASE_CONFLICT",
      "WRITE_OUTCOME_UNKNOWN",
    ])
      authority.observe(new StudioClientError(code));
    authority.observe(Error("untyped failure"));
    expect(authority.accepts(ticket)).toBe(true);
    expect(authority.accepts({ ...ticket })).toBe(false);
    expect(new InternalProductAuthority("test-product").accepts(ticket)).toBe(
      false,
    );
  });
});
