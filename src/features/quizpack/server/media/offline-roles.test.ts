import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./internal/macos/policy", () => ({
  loadMacPolicy: mocks.load,
  supportedOSInfo: vi.fn(),
  macPolicyComponentId: vi.fn(),
}));
const originalArgv = process.argv;
beforeEach(() => {
  vi.resetModules();
  mocks.load
    .mockReset()
    .mockReturnValue({
      profileId: "a".repeat(64),
      componentId: "b".repeat(64),
    });
});
afterEach(() => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
});
describe("trusted offline target roles", () => {
  it.each(["main", "fixture"])(
    "%s uses fixed ordinary roles while keeping probes private",
    async (target) => {
      process.argv = [
        process.execPath,
        "synthetic",
        `--runtime-target=${target}`,
      ];
      vi.stubEnv("QUIZFORGE_MEDIA_ROOT", "/synthetic-untrusted");
      const mac =
        await import("../../../../../scripts/quizpack-media-preflight/macos/policy");
      const control =
        await import("../../../../../scripts/quizpack-media-preflight/macos/control");
      const linux =
        await import("../../../../../scripts/quizpack-media-preflight/linux/common.mjs");
      expect(mac.MAC_ROOT).toContain("/.cache/quizpack-media-preflight/macos");
      expect(mac.POSIX_PROBE).toBe(`${mac.MAC_ROOT}/tools/posix-probe`);
      expect(mac.MAC_IDENTITY_HELPER).toBe(
        `${mac.RUNTIME_STATE}/tools/identity-helper`,
      );
      expect(control.CONTROL_ROOT).toBe(`${mac.RUNTIME_STATE}/control`);
      mac.loadPolicy();
      expect(mocks.load.mock.calls[0]?.[2]).toBeUndefined();
      mac.loadPolicy("fault");
      expect(mocks.load.mock.calls[1]?.[2]).toMatchObject({
        kind: "fault",
        script: mac.FAULT_WORKER,
      });
      expect(linux.STATE).toBe(
        `${linux.ROOT}/.cache/quizpack-media-runtime/linux-x64`,
      );
      expect(linux.CACHE).toBe(
        `${linux.ROOT}/.cache/quizpack-media-preflight/linux`,
      );
      expect(linux.RUNTIME_ROOTS.deploymentRoot).toBe(
        `${linux.ROOT}/${target === "main" ? ".next" : ".cache/quizpack-media-next-fixture/.next"}`,
      );
    },
  );
  it("unknown target and legacy sealing are rejected rather than selecting a role", async () => {
    process.argv = [
      process.execPath,
      "synthetic",
      "--runtime-target=/synthetic",
    ];
    await expect(
      import("../../../../../scripts/quizpack-media-preflight/macos/policy"),
    ).rejects.toThrow("INVALID_RUNTIME_TARGET");
    await expect(
      import("../../../../../scripts/quizpack-media-preflight/linux/common.mjs"),
    ).rejects.toThrow("INVALID_RUNTIME_TARGET");
    vi.resetModules();
    process.argv = [
      process.execPath,
      "synthetic",
      "--runtime-target=fixture",
      "--record-capability",
    ];
    await expect(
      import("../../../../../scripts/quizpack-media-preflight/macos/policy"),
    ).rejects.toThrow("INVALID_RUNTIME_TARGET");
  });
});
