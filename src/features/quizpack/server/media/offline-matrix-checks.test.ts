import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  run: vi.fn(),
  policy: vi.fn(),
  controlRoot: "",
  roots: { checkoutRoot: "", deploymentRoot: "" },
}));
vi.mock(
  "../../../../../scripts/quizpack-media-preflight/macos/control",
  () => ({
    get CONTROL_ROOT() {
      return mocks.controlRoot;
    },
    readControlForHarness: mocks.read,
  }),
);
vi.mock("../../../../../scripts/quizpack-media-preflight/macos/policy", () => ({
  RUNTIME_TARGET: "fixture",
  RUNTIME_ROOTS: mocks.roots,
  loadPolicy: mocks.policy,
}));
vi.mock(
  "../../../../../scripts/quizpack-media-preflight/macos/launcher",
  () => ({ runHarnessCase: mocks.run }),
);
let root: string;
const profileId = "a".repeat(64),
  runId = "00000000-0000-4000-8000-000000000001";
const issued = {
  runId,
  profileId,
  ownerPid: process.pid,
  phase: "issued",
  pid: null,
  workerStart: null,
};
const spawned = {
  ...issued,
  phase: "spawned",
  pid: 4321,
  workerStart: { sec: 100, usec: 1 },
};
const output = Buffer.from(
  JSON.stringify({
    ok: true,
    mediaType: "image/png",
    width: 2,
    height: 2,
    frames: 1,
    mediaDecoded: true,
  }),
);
beforeEach(() => {
  vi.resetModules();
  root = mkdtempSync(join(tmpdir(), "quizforge-synthetic-matrix-"));
  mocks.controlRoot = join(root, "control");
  mkdirSync(mocks.controlRoot, { mode: 0o700 });
  mocks.roots.checkoutRoot = root;
  mocks.roots.deploymentRoot = join(root, ".next");
  mocks.read.mockReset();
  mocks.run.mockReset();
  mocks.policy.mockReset().mockReturnValue({ profileId });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});
describe("closed offline Mac matrix proofs", () => {
  it("waits through initialization to an exact spawned identity before blocking the original absolute deadline", async () => {
    const { checkDelayedOwnedTimer } =
      await import("../../../../../scripts/quizpack-media-preflight/macos/matrix-checks");
    let now = 100,
      owned = false,
      deadline = 0;
    let finish: () => void = () => {};
    mocks.read
      .mockImplementationOnce(() => issued)
      .mockImplementationOnce(() => issued)
      .mockImplementation(() => {
        owned = true;
        return spawned;
      });
    mocks.run.mockImplementation((_plan, ctx) => {
      deadline = ctx.deadlineMonotonicMs;
      return new Promise((resolve) => {
        finish = () =>
          resolve({
            runId,
            profileId,
            workerObserved: true,
            code: "DEADLINE_EXCEEDED",
            stopped: "confirmed",
            output,
          });
      });
    });
    vi.spyOn(performance, "now").mockImplementation(() => {
      if (owned) now += 100;
      if (now >= deadline + 200 && deadline) finish();
      return now;
    });
    const pending = checkDelayedOwnedTimer();
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(owned).toBe(false);
    expect(now).toBe(100);
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toEqual({
      ownedWorkerObserved: true,
      apparentSuccessRejected: true,
      stopped: "confirmed",
      code: "DEADLINE_EXCEEDED",
    });
    expect(deadline).toBe(5100);
    expect(mocks.run).toHaveBeenCalledWith(
      { kind: "fault", scenario: "success-hang" },
      expect.objectContaining({ deadlineMonotonicMs: 5100 }),
    );
  });
  it("a worker that never reaches spawned fails the case and drains its own operation", async () => {
    const { checkDelayedOwnedTimer } =
      await import("../../../../../scripts/quizpack-media-preflight/macos/matrix-checks");
    let now = 100,
      aborted = false;
    vi.spyOn(performance, "now").mockImplementation(() => (now += 100));
    mocks.read.mockReturnValue(issued);
    mocks.run.mockImplementation(
      (_plan, ctx) =>
        new Promise((resolve) => {
          ctx.signal.addEventListener("abort", () => {
            aborted = true;
            resolve({
              runId,
              profileId,
              workerObserved: false,
              code: "CANCELLED",
              stopped: "confirmed",
              output,
            });
          });
        }),
    );
    const pending = checkDelayedOwnedTimer();
    const rejected = expect(pending).rejects.toThrow(
      "SYNTHETIC_ASSERTION_FAILED",
    );
    await vi.runAllTimersAsync();
    await rejected;
    expect(aborted).toBe(true);
  });
  it("a replacement owned record fails before entering the blocking section", async () => {
    const { checkDelayedOwnedTimer } =
      await import("../../../../../scripts/quizpack-media-preflight/macos/matrix-checks");
    vi.spyOn(performance, "now").mockReturnValue(100);
    mocks.read.mockReturnValueOnce(issued).mockReturnValue({
      ...spawned,
      runId: "00000000-0000-4000-8000-000000000002",
    });
    mocks.run.mockImplementation(
      (_plan, ctx) =>
        new Promise((resolve) =>
          ctx.signal.addEventListener("abort", () =>
            resolve({ code: "CANCELLED", stopped: "confirmed" }),
          ),
        ),
    );
    await expect(checkDelayedOwnedTimer()).rejects.toThrow(
      "SYNTHETIC_ASSERTION_FAILED",
    );
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });
  it.each(["absent", "present"])(
    "invalid opaque receipt preserves the actual %s production capability",
    async (state) => {
      const { checkRejectedTargetSeal } =
        await import("../../../../../scripts/quizpack-media-preflight/macos/matrix-checks");
      const directory = join(
        root,
        ".cache/quizpack-media-runtime/darwin-arm64",
      );
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const path = join(directory, "capability.json");
      const capability = {
        schema: "quizpack-media-capability.v1",
        platform: "darwin-arm64",
        componentId: "b".repeat(64),
        deploymentId: "c".repeat(64),
        runtimeBundleHash: "d".repeat(64),
        limitsHash: "e".repeat(64),
        profileId,
      };
      const before = Buffer.from(JSON.stringify(capability, null, 2) + "\n");
      if (state === "present") writeFileSync(path, before, { mode: 0o600 });
      expect(await checkRejectedTargetSeal()).toEqual({
        ordinaryCapabilityUntouched: true,
        receiptRejected: true,
        capabilityCommitted: false,
      });
      expect(readdirSync(directory)).toEqual(
        state === "present" ? ["capability.json"] : [],
      );
      if (state === "present") expect(readFileSync(path)).toEqual(before);
      expect(mocks.run).not.toHaveBeenCalled();
    },
  );
});
