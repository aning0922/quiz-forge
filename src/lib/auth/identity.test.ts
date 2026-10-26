import { describe, expect, it } from "vitest";
import { studioOperatorIdentitySchema } from "./identity";
import { verifiedActor } from "./capabilities";

const identity = {
  id: "00000000-0000-4000-8000-000000000001",
  loginName: "synthetic.admin",
  displayName: "合成管理员",
  role: "admin" as const,
  accountRevision: 1,
};
describe("current operator identity", () => {
  it("accepts a complete canonical identity for every current role", () => {
    for (const role of ["admin", "operator", "read-only"])
      expect(studioOperatorIdentitySchema.parse({ ...identity, role })).toEqual(
        { ...identity, role },
      );
  });
  it("rejects missing/null fields and legacy labels instead of deriving identity", () => {
    for (const key of Object.keys(identity)) {
      const value = { ...identity } as Record<string, unknown>;
      delete value[key];
      expect(studioOperatorIdentitySchema.safeParse(value).success).toBe(false);
      expect(
        studioOperatorIdentitySchema.safeParse({ ...identity, [key]: null })
          .success,
      ).toBe(false);
    }
    expect(
      studioOperatorIdentitySchema.safeParse({ ...identity, label: "legacy" })
        .success,
    ).toBe(false);
  });
  it("rejects values that input normalization could repair and invalid authority revisions", () => {
    for (const invalid of [
      { loginName: "Synthetic.Admin" },
      { loginName: " synthetic.admin " },
      { displayName: " 合成管理员" },
      { displayName: "合成管理员\u00a0" },
      { displayName: "合成\u0085管理员" },
      { role: "unknown" },
      { accountRevision: 0 },
      { accountRevision: 1.5 },
      { accountRevision: "1" },
      { accountRevision: 2147483648 },
    ])
      expect(
        studioOperatorIdentitySchema.safeParse({ ...identity, ...invalid })
          .success,
      ).toBe(false);
  });
  it("refuses to brand an incomplete identity or malformed session", () => {
    const actor = {
      ...identity,
      sessionId: "00000000-0000-4000-8000-000000000002",
      idleExpiresAt: new Date(),
      absoluteExpiresAt: new Date(),
    };
    expect(verifiedActor(actor).loginName).toBe(identity.loginName);
    expect(
      verifiedActor({ ...actor, label: "obsolete" } as typeof actor),
    ).not.toHaveProperty("label");
    for (const invalid of [
      { displayName: undefined },
      { accountRevision: undefined },
      { sessionId: "legacy-session" },
      { absoluteExpiresAt: new Date(NaN) },
    ])
      expect(() =>
        verifiedActor({ ...actor, ...invalid } as typeof actor),
      ).toThrow("STUDIO_UNAVAILABLE");
  });
});
