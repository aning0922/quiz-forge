import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMediaOperationContext,
  disposeMediaOperationContext,
  requestMediaOperationStop,
} from "../operation-context";
import { MediaPolicyError } from "./runtime-files";
import { readMediaOperationState } from "../operation-context";
import { parseLaunchResult } from "../evidence";
import type { ImageDeclaration } from "../contracts";
const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  mac: vi.fn(),
  seal: vi.fn(),
  run: vi.fn(),
  mkdir: vi.fn(),
  linuxRead: vi.fn(),
  linuxExecute: vi.fn(),
}));
vi.mock("../../../../../lib/build/media-deployment", () => ({
  verifyMediaDeployment: mocks.verify,
}));
vi.mock("./macos/policy", () => ({ loadMacPolicy: mocks.mac }));
vi.mock("./capability", () => ({ readMediaCapability: mocks.seal }));
vi.mock("./macos/control", () => ({
  ensurePrivateDirectory: mocks.mkdir,
  createMacControl: () => ({ acquireControl: vi.fn() }),
}));
vi.mock("./macos/execute", () => ({ runOwnedMac: mocks.run }));
vi.mock("./linux/policy", () => ({
  createLinuxNormalRuntime: () => ({
    core: { readPolicy: mocks.linuxRead, execute: mocks.linuxExecute },
  }),
}));
import { createTrustedMediaRuntime } from "./runtime";
const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const declaration: ImageDeclaration = {
  path: "assets/synthetic.png",
  mediaType: "image/png",
  sha256: createHash("sha256").update(bytes).digest("hex"),
  bytes: bytes.length,
  width: 1,
  height: 1,
};
const roots = {
  checkoutRoot: "/synthetic",
  deploymentRoot: "/synthetic/.next",
};
const policy = {
  profile: "synthetic",
  profileId: "b".repeat(64),
  componentId: "c".repeat(64),
  node: "/synthetic/node",
  identity: {},
};
const contexts: ReturnType<typeof createMediaOperationContext>[] = [];
function context() {
  const c = createMediaOperationContext({
    signal: new AbortController().signal,
    deadlineMonotonicMs: performance.now() + 60_000,
  });
  contexts.push(c);
  return c;
}
beforeEach(() => {
  vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
  vi.spyOn(process, "arch", "get").mockReturnValue("arm64");
  mocks.verify.mockReset().mockResolvedValue({
    ok: true,
    summary: {
      sourceBundleHash: "a".repeat(64),
      deploymentId: "d".repeat(64),
    },
  });
  mocks.mac.mockReset().mockReturnValue(policy);
  mocks.seal.mockReset().mockImplementation(() => {
    throw new Error("synthetic-unsealed");
  });
  mocks.run.mockReset().mockImplementation(async (runId, execution) => ({
    runId,
    profileId: execution.policy.profileId,
    code: null,
    stopped: "confirmed",
    output: Buffer.from(
      JSON.stringify({
        ok: true,
        mediaType: "image/png",
        width: 1,
        height: 1,
        frames: 1,
        mediaDecoded: true,
      }),
    ),
  }));
});
afterEach(() => {
  for (const c of contexts.splice(0)) disposeMediaOperationContext(c);
  vi.restoreAllMocks();
});
describe("trusted fixed runtime binding and launch", () => {
  it("candidate checks actual deployment and component while sealed mode cannot authorize absent seal", async () => {
    const runtime = createTrustedMediaRuntime(roots),
      c = context();
    const snapshot = await runtime.readSealCandidate(c);
    expect(snapshot).toMatchObject({
      outcome: "bound",
      profileId: policy.profileId,
      binding: { componentId: policy.componentId },
    });
    expect(mocks.verify).toHaveBeenCalledWith(
      roots,
      expect.objectContaining({
        signal: c.signal,
        deadlineMonotonicMs: c.deadlineMonotonicMs,
        checkpoint: expect.any(Function),
      }),
    );
    expect(await runtime.run(bytes, declaration, c, "sealed")).toMatchObject({
      code: "ISOLATION_UNAVAILABLE",
      stopped: "not-started",
    });
    expect(mocks.run).not.toHaveBeenCalled();
    const result = await runtime.run(bytes, declaration, c, "candidate");
    expect(result).toMatchObject({
      outcome: "decoded",
      profileId: policy.profileId,
      stopped: "confirmed",
    });
    expect(parseLaunchResult(Buffer.from(JSON.stringify(result)))).toEqual({
      ok: true,
      value: result,
    });
    expect(mocks.run.mock.calls[0]?.[1]).toMatchObject({
      args: [
        "/synthetic/src/features/quizpack/v1/media-worker.mjs",
        "8388608",
        "8192",
        "16000000",
      ],
    });
  });
  it("seal must match deployment, component, limits, bundle and normal profile", async () => {
    const runtime = createTrustedMediaRuntime(roots),
      c = context();
    const value = await runtime.readSealCandidate(c);
    if (value.outcome !== "bound") throw new Error("synthetic");
    mocks.seal.mockReturnValue({
      ...value.binding,
      schema: "quizpack-media-capability.v1",
      profileId: value.profileId,
    });
    expect(await runtime.run(bytes, declaration, c, "sealed")).toMatchObject({
      outcome: "decoded",
    });
    mocks.seal.mockReturnValue({
      ...value.binding,
      schema: "quizpack-media-capability.v1",
      profileId: "e".repeat(64),
    });
    expect(await runtime.run(bytes, declaration, c, "sealed")).toMatchObject({
      code: "ISOLATION_UNAVAILABLE",
    });
    expect(mocks.run).toHaveBeenCalledOnce();
  });
  it("a changed binding in one operation cannot silently replace its pinned identity", async () => {
    const runtime = createTrustedMediaRuntime(roots),
      c = context();
    expect(await runtime.readBinding(c, "candidate")).toMatchObject({
      outcome: "bound",
    });
    mocks.mac.mockReturnValue({ ...policy, componentId: "e".repeat(64) });
    expect(await runtime.run(bytes, declaration, c, "candidate")).toMatchObject(
      { code: "ISOLATION_UNAVAILABLE" },
    );
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("single image deadline includes manifest verification and refuses a late policy", async () => {
    const runtime = createTrustedMediaRuntime(roots),
      c = context(),
      start = performance.now();
    const clock = vi.spyOn(performance, "now").mockReturnValue(start);
    let deadline = 0;
    mocks.verify.mockImplementation(async (_roots, supplied) => {
      deadline = supplied.deadlineMonotonicMs;
      clock.mockReturnValue(start + 5001);
      return {
        ok: true,
        summary: {
          sourceBundleHash: "a".repeat(64),
          deploymentId: "d".repeat(64),
        },
      };
    });
    const result = await runtime.run(bytes, declaration, c, "candidate");
    expect(deadline).toBe(start + 5000);
    expect(result).toMatchObject({
      code: "DEADLINE_EXCEEDED",
      stopped: "not-started",
    });
    expect(mocks.mac).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("shared unknown dominates malformed image input and no IO is issued", async () => {
    const runtime = createTrustedMediaRuntime(roots),
      c = context();
    requestMediaOperationStop(c, "CANCELLED");
    requestMediaOperationStop(c, "STOP_UNCONFIRMED");
    const result = await runtime.run(
      new Uint8Array([1]),
      declaration,
      c,
      "candidate",
    );
    expect(result).toMatchObject({
      code: "STOP_UNCONFIRMED",
      stopped: "unknown",
    });
    expect(parseLaunchResult(Buffer.from(JSON.stringify(result)))).toEqual({
      ok: true,
      value: result,
    });
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("an explicit unknown policy error upgrades an earlier cancellation", async () => {
    const runtime = createTrustedMediaRuntime(roots),
      c = context();
    mocks.mac.mockImplementation(() => {
      requestMediaOperationStop(c, "CANCELLED");
      throw new MediaPolicyError("STOP_UNCONFIRMED");
    });
    expect(await runtime.readBinding(c, "candidate")).toEqual({
      outcome: "unavailable",
      code: "STOP_UNCONFIRMED",
    });
    expect(readMediaOperationState(c)).toMatchObject({
      phase: "stopping",
      stop: { reason: "STOP_UNCONFIRMED" },
    });
  });
  it.each(["reject", "malformed", "wrong-run", "invalid-stop"])(
    "trusted Mac %s cannot claim a not-started stop",
    async (kind) => {
      const runtime = createTrustedMediaRuntime(roots),
        c = context();
      mocks.run.mockImplementation(async (runId, execution) => {
        if (kind === "reject") {
          requestMediaOperationStop(c, "CANCELLED");
          throw new Error("synthetic");
        }
        if (kind === "malformed") return {};
        if (kind === "wrong-run")
          return {
            runId: "626e311b-4211-4f35-b874-a39d801b2df6",
            profileId: execution.policy.profileId,
            code: null,
            stopped: "confirmed",
            output: Buffer.alloc(0),
          };
        return {
          runId,
          profileId: execution.policy.profileId,
          code: "STOP_UNCONFIRMED",
          stopped: "not-started",
          output: Buffer.alloc(0),
        };
      });
      const result = await runtime.run(bytes, declaration, c, "candidate");
      expect(result).toMatchObject({
        code: "STOP_UNCONFIRMED",
        stopped: "unknown",
      });
      expect(readMediaOperationState(c)).toMatchObject({
        phase: "stopping",
        stop: { reason: "STOP_UNCONFIRMED" },
      });
      expect(parseLaunchResult(Buffer.from(JSON.stringify(result)))).toEqual({
        ok: true,
        value: result,
      });
      expect(
        await runtime.run(bytes, declaration, c, "candidate"),
      ).toMatchObject({ code: "STOP_UNCONFIRMED", stopped: "unknown" });
      expect(mocks.run).toHaveBeenCalledOnce();
    },
  );
  it.each([
    "policy-reject",
    "policy-malformed",
    "execute-reject",
    "execute-malformed",
  ])("Linux trusted %s retains unknown facts", async (kind) => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    vi.spyOn(process, "arch", "get").mockReturnValue("x64");
    const runtime = createTrustedMediaRuntime(roots),
      c = context();
    if (kind === "policy-reject")
      mocks.linuxRead.mockImplementation(async () => {
        requestMediaOperationStop(c, "CANCELLED");
        throw new Error("synthetic");
      });
    if (kind === "policy-malformed") mocks.linuxRead.mockResolvedValue({});
    if (kind === "execute-reject")
      mocks.linuxExecute.mockRejectedValue(new Error("synthetic"));
    if (kind === "execute-malformed") mocks.linuxExecute.mockResolvedValue({});
    const result = kind.startsWith("policy")
      ? await runtime.readBinding(c, "candidate")
      : await runtime.run(bytes, declaration, c, "candidate");
    expect(result).toMatchObject({ code: "STOP_UNCONFIRMED" });
    expect(readMediaOperationState(c)).toMatchObject({
      phase: "stopping",
      stop: { reason: "STOP_UNCONFIRMED" },
    });
  });
  it("late output checkpoint retains actual confirmed stop evidence", async () => {
    const runtime = createTrustedMediaRuntime(roots),
      c = context();
    mocks.run.mockImplementation(async (runId, execution) => {
      requestMediaOperationStop(c, "CANCELLED");
      return {
        runId,
        profileId: execution.policy.profileId,
        code: null,
        stopped: "confirmed",
        output: Buffer.from("synthetic"),
      };
    });
    expect(await runtime.run(bytes, declaration, c, "candidate")).toMatchObject(
      { code: "CANCELLED", stopped: "confirmed" },
    );
  });
});
