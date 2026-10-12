import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  roots: vi.fn(),
  create: vi.fn(),
  read: vi.fn(),
  run: vi.fn(),
}));
vi.mock("./internal/runtime-location", () => ({
  fixedMediaRuntimeRoots: mocks.roots,
}));
vi.mock("./internal/runtime", () => ({
  createTrustedMediaRuntime: mocks.create,
}));
const cleanup: (() => void)[] = [];
beforeEach(() => {
  vi.resetModules();
  mocks.roots
    .mockReset()
    .mockReturnValue({
      checkoutRoot: "/synthetic",
      deploymentRoot: "/synthetic/.next",
    });
  mocks.create
    .mockReset()
    .mockReturnValue({ readBinding: mocks.read, run: mocks.run });
  mocks.read
    .mockReset()
    .mockResolvedValue({
      outcome: "unavailable",
      code: "ISOLATION_UNAVAILABLE",
    });
  mocks.run
    .mockReset()
    .mockResolvedValue({
      outcome: "failed",
      runId: "626e311b-4211-4f35-b874-a39d801b2df6",
      profileId: null,
      code: "ISOLATION_UNAVAILABLE",
      stopped: "not-started",
    });
});
afterEach(() => {
  for (const done of cleanup.splice(0)) done();
});
async function fixture() {
  const op = await import("./operation-context"),
    entry = await import("./runtime-binding");
  const context = op.createMediaOperationContext({
    signal: new AbortController().signal,
    deadlineMonotonicMs: performance.now() + 60_000,
  });
  cleanup.push(() => op.disposeMediaOperationContext(context));
  return { op, entry, context };
}
const declaration = {
  path: "assets/synthetic.png",
  mediaType: "image/png" as const,
  sha256: "a".repeat(64),
  bytes: 1,
  width: 1,
  height: 1,
};
describe("ordinary trusted runtime boundary", () => {
  it("locator failure before runtime invocation remains finite not-started", async () => {
    mocks.roots.mockImplementation(() => {
      throw new Error("synthetic");
    });
    const { entry, op, context } = await fixture();
    expect(await entry.readMediaRuntimeBinding(context)).toEqual({
      outcome: "unavailable",
      code: "ISOLATION_UNAVAILABLE",
    });
    expect(
      await entry.runFixedIsolatedImage(
        new Uint8Array([1]),
        declaration,
        context,
      ),
    ).toMatchObject({ code: "ISOLATION_UNAVAILABLE", stopped: "not-started" });
    expect(op.readMediaOperationState(context).phase).toBe("active");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("valid finite denial from trusted runtime remains an active not-started fact", async () => {
    const { entry, op, context } = await fixture();
    expect(await entry.readMediaRuntimeBinding(context)).toEqual({
      outcome: "unavailable",
      code: "ISOLATION_UNAVAILABLE",
    });
    expect(
      await entry.runFixedIsolatedImage(
        new Uint8Array([1]),
        declaration,
        context,
      ),
    ).toMatchObject({ code: "ISOLATION_UNAVAILABLE", stopped: "not-started" });
    expect(op.readMediaOperationState(context).phase).toBe("active");
  });
  it.each([
    "binding-reject",
    "binding-malformed",
    "run-reject",
    "run-malformed",
  ])(
    "%s upgrades shared state and cannot authorize another invocation",
    async (kind) => {
      const { entry, op, context } = await fixture();
      const rejection = async () => {
        op.requestMediaOperationStop(context, "CANCELLED");
        throw new Error("synthetic");
      };
      if (kind === "binding-reject") mocks.read.mockImplementation(rejection);
      if (kind === "binding-malformed")
        mocks.read.mockResolvedValue({ outcome: "bound", binding: {} });
      if (kind === "run-reject") mocks.run.mockImplementation(rejection);
      if (kind === "run-malformed")
        mocks.run.mockResolvedValue({
          outcome: "failed",
          code: "WORKER_FAILED",
          stopped: "not-started",
        });
      const result = kind.startsWith("binding")
        ? await entry.readMediaRuntimeBinding(context)
        : await entry.runFixedIsolatedImage(
            new Uint8Array([1]),
            declaration,
            context,
          );
      expect(result).toMatchObject({ code: "STOP_UNCONFIRMED" });
      expect(op.readMediaOperationState(context)).toMatchObject({
        phase: "stopping",
        stop: { reason: "STOP_UNCONFIRMED" },
      });
      expect(
        await entry.runFixedIsolatedImage(
          new Uint8Array([1]),
          declaration,
          context,
        ),
      ).toMatchObject({ code: "STOP_UNCONFIRMED", stopped: "unknown" });
      expect(
        kind.startsWith("binding") ? mocks.read : mocks.run,
      ).toHaveBeenCalledOnce();
    },
  );
});
