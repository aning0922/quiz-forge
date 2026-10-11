import { afterEach, describe, expect, it, vi } from "vitest";
import { cookieToken, PREAUTH_COOKIE } from "./cookies";
import { handleStudioAuth } from "./http";

afterEach(() => vi.unstubAllEnvs());

describe("Studio cookie and unavailable boundary", () => {
  it("rejects duplicate auth cookies rather than choosing a shadowed value", () => {
    expect(() =>
      cookieToken(
        new Headers({ cookie: `${PREAUTH_COOKIE}=a; ${PREAUTH_COOKIE}=b` }),
        "preauth",
      ),
    ).toThrow("INVALID_REQUEST");
    expect(
      cookieToken(
        new Headers({
          cookie: `${PREAUTH_COOKIE}=synthetic-input; unrelated=value`,
        }),
        "preauth",
      ),
    ).toBe("synthetic-input");
    expect(cookieToken(new Headers(), "session")).toBeNull();
  });
  it("fails closed with missing config and never falls back to DATABASE_URL", async () => {
    vi.stubEnv("QUIZFORGE_P2A_CONFIG", "");
    vi.stubEnv("DATABASE_URL", "deliberately-unused");
    for (const endpoint of ["preauth", "login", "session", "logout"] as const) {
      const response = await handleStudioAuth(
        new Request("http://127.0.0.1:3100/api/studio/auth/" + endpoint),
        endpoint,
      );
      expect(response.status).toBe(503);
      expect(response.headers.has("set-cookie")).toBe(false);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const value: unknown = await response.json();
      expect(value).toMatchObject({
        code: "STUDIO_UNAVAILABLE",
        requestId: expect.any(String),
      });
      expect(Object.keys(value as object).sort()).toEqual([
        "code",
        "requestId",
      ]);
    }
  });
});
