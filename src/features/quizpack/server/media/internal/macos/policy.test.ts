import { describe, expect, it } from "vitest";
import { renderMacPermissionProfile, macPolicyComponentId } from "./policy";
describe("single Mac permission and component contract", () => {
  it("quotes finite literals while preserving deny-default policy for worker and probe plans", () => {
    const root = '/synthetic/a"b';
    for (const executable of ["/synthetic/node", "/synthetic/probe"]) {
      const profile = renderMacPermissionProfile(
        root,
        "/synthetic/node",
        ["/synthetic/dependency"],
        { kind: "synthetic", executable, script: root + "/worker.mjs" },
      );
      expect(profile).toContain("(deny default)");
      expect(profile).toContain(
        `(allow process-exec (literal ${JSON.stringify(executable)}))`,
      );
      expect(profile).toContain(JSON.stringify(root + "/worker.mjs"));
      expect(profile).not.toContain("(allow network");
      expect(profile).not.toContain("(allow mach");
      expect(profile).not.toContain("(allow file-write");
    }
  });
  it("component identity includes altered facts, excludes only rendered path metadata", () => {
    const identity = {
      schema: "mac-media-policy.v2",
      nodeSha256: "a".repeat(64),
      profileSha256: "b".repeat(64),
      componentId: "c".repeat(64),
      dependencies: [{ path: "/synthetic/one", sha256: "d".repeat(64) }],
    };
    const first = macPolicyComponentId({ identity });
    expect(
      macPolicyComponentId({
        identity: { ...identity, nodeSha256: "e".repeat(64) },
      }),
    ).not.toBe(first);
    expect(
      macPolicyComponentId({
        identity: {
          ...identity,
          profileSha256: "f".repeat(64),
          dependencies: [{ path: "/synthetic/two", sha256: "d".repeat(64) }],
        },
      }),
    ).toBe(first);
  });
});
