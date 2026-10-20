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
    id: "synthetic-operator",
    label: "synthetic",
    role,
    sessionId: "synthetic-session",
    idleExpiresAt: new Date(),
    absoluteExpiresAt: new Date(),
  });

describe("data-source capabilities", () => {
  it("permits both roles to read and only operator to mutate", () => {
    for (const role of ["operator", "read-only"] as const)
      expect(() => requireCapability(actor(role), "studio:read")).not.toThrow();
    for (const capability of [
      "workspace:write",
      "draft:write",
      "import:create",
      "review:submit",
      "review:return",
    ] as const) {
      expect(() =>
        requireCapability(actor("operator"), capability),
      ).not.toThrow();
      expect(() => requireCapability(actor("read-only"), capability)).toThrow(
        "CAPABILITY_DENIED",
      );
    }
  });
  it("rejects unverified client-shaped actors and unregistered future abilities", () => {
    expect(() =>
      requireCapability({ role: "operator" } as StudioActor, "studio:read"),
    ).toThrow("CAPABILITY_DENIED");
    for (const capability of ["publish", "key:create"])
      expect(() =>
        requireCapability(actor("operator"), capability as StudioCapability),
      ).toThrow("CAPABILITY_DENIED");
  });
});
