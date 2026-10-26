import { describe, expect, it } from "vitest";
import {
  requireCapability,
  verifiedActor,
  type StudioActor,
  type StudioCapability,
  type StudioRole,
} from "./capabilities";

const actor = (role: StudioRole) =>
  verifiedActor({
    id: "00000000-0000-4000-8000-000000000001",
    loginName: "synthetic-operator",
    displayName: "合成运营",
    accountRevision: 1,
    role,
    sessionId: "00000000-0000-4000-8000-000000000002",
    idleExpiresAt: new Date(),
    absoluteExpiresAt: new Date(),
  });

describe("data-source capabilities", () => {
  it("permits all roles to read and manage their own password/session", () => {
    for (const role of ["admin", "operator", "read-only"] as const) {
      expect(() => requireCapability(actor(role), "studio:read")).not.toThrow();
      expect(() =>
        requireCapability(actor(role), "account:self"),
      ).not.toThrow();
    }
  });
  it("permits operators to edit content and issue keys but denies read-only writes", () => {
    for (const capability of [
      "workspace:write",
      "draft:write",
      "import:create",
      "access-key:issue",
      "access-key:void",
    ] as const) {
      for (const role of ["admin", "operator"] as const)
        expect(() => requireCapability(actor(role), capability)).not.toThrow();
      expect(() => requireCapability(actor("read-only"), capability)).toThrow(
        "CAPABILITY_DENIED",
      );
    }
  });
  it("reserves review, archive, global taxonomy and account administration to admins", () => {
    for (const capability of [
      "workspace:archive",
      "taxonomy:manage",
      "review:submit",
      "review:return",
      "review:record-baseline",
      "version:seal-internal",
      "account:manage",
      "account:audit",
    ] as const) {
      expect(() => requireCapability(actor("admin"), capability)).not.toThrow();
      for (const role of ["operator", "read-only"] as const)
        expect(() => requireCapability(actor(role), capability)).toThrow(
          "CAPABILITY_DENIED",
        );
    }
  });
  it("rejects unverified client-shaped actors and unregistered future abilities", () => {
    expect(() =>
      requireCapability({ role: "operator" } as StudioActor, "studio:read"),
    ).toThrow("CAPABILITY_DENIED");
    for (const capability of ["publish", "key:create"])
      for (const role of ["admin", "operator", "read-only"] as const)
        expect(() =>
          requireCapability(actor(role), capability as StudioCapability),
        ).toThrow("CAPABILITY_DENIED");
  });
});
